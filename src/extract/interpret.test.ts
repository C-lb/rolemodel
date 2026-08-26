import { describe, it, expect, vi } from "vitest";
import {
  buildInterpretPayload,
  interpretPrompt,
  payloadHash,
  interpretRatio,
  INTERPRET_PROMPT_VERSION,
  InterpretationSchema,
  type InterpretApi,
  type InterpretPayload,
} from "./interpret";
import { MODEL_ID } from "./client";
import { computeRatios } from "@/model/ratios/compute";
import { ratio } from "@/model/ratios/library";
import { fixtureWorkspace } from "@/model/ratios/fixtures";

function resultFor(key: string) {
  const all = computeRatios({ workspace: fixtureWorkspace(), mode: "ending", custom: [] });
  const found = all.find((r) => r.key === key);
  if (!found) throw new Error(`no ratio "${key}"`);
  return found;
}

function payloadFor(key = "net_margin"): InterpretPayload {
  return buildInterpretPayload(resultFor(key), ratio(key) ?? null, "ending");
}

describe("the payload", () => {
  it("carries the computed numbers for every period", () => {
    const payload = payloadFor();
    expect(payload.periods.map((p) => p.periodKey)).toEqual(["FY2022", "FY2023", "FY2024"]);
    const latest = payload.periods[payload.periods.length - 1];
    expect(latest.value).toBeCloseTo(0.14, 6);
    expect(latest.numerator).toBe(2100);
    expect(latest.denominator).toBe(15000);
  });

  it("puts the periods in chronological order", () => {
    // The results are display-ordered, most recent first. A model reading that order
    // describes the trend backwards, so the payload reverses it deliberately.
    expect(resultFor("net_margin").periods[0].periodKey).toBe("FY2024");
    expect(payloadFor().periods[0].periodKey).toBe("FY2022");
  });

  it("carries the authored definition rather than the raw expression", () => {
    const payload = payloadFor();
    expect(payload.definition).toContain("Net income as a percentage of revenue");
    expect(payload.unit).toBe("percent");
    expect(payload.direction).toBe("higher");
  });

  it("passes null rather than a fabricated zero where a figure is missing", () => {
    const all = computeRatios({
      workspace: fixtureWorkspace({ rows: { FY2024: { revenue: 15000 } } }),
      mode: "ending",
      custom: [],
    });
    const roe = all.find((r) => r.key === "roe");
    if (!roe) throw new Error("no roe");
    const payload = buildInterpretPayload(roe, ratio("roe") ?? null, "ending");
    expect(payload.periods[0].value).toBeNull();
    expect(payload.periods[0].numerator).toBeNull();
  });

  it("never carries anything the extractor saw", () => {
    // The fixture stamps this string onto every fact's provenance.
    const payload = payloadFor();
    const serialised = JSON.stringify(payload) + interpretPrompt(payload);
    expect(serialised).not.toContain("fixture");
    expect(serialised).not.toContain("rawLabel");
  });
});

describe("the prompt", () => {
  const prompt = interpretPrompt(payloadFor());

  it("states every constraint the spec requires", () => {
    expect(prompt).toMatch(/arithmetic|driver/i);
    expect(prompt).toMatch(/decline/i);
    expect(prompt).toMatch(/two periods/i);
    expect(prompt).toMatch(/forecast|predict|future/i);
    expect(prompt).toMatch(/80 words/i);
  });

  it("names the ratio and its periods", () => {
    expect(prompt).toContain("Net margin");
    expect(prompt).toContain("FY2022");
    expect(prompt).toContain("FY2024");
  });

  it("says which balance convention produced the numbers", () => {
    expect(interpretPrompt(payloadFor())).toMatch(/ending balance/i);
    const averaged = buildInterpretPayload(resultFor("roa"), ratio("roa") ?? null, "average");
    expect(interpretPrompt(averaged)).toMatch(/average of opening and closing/i);
  });
});

describe("the hash", () => {
  it("is stable for the same numbers", () => {
    expect(payloadHash(payloadFor(), MODEL_ID)).toBe(payloadHash(payloadFor(), MODEL_ID));
  });

  it("changes when a value changes", () => {
    const edited = payloadFor();
    edited.periods[0].value = 0.99;
    expect(payloadHash(edited, MODEL_ID)).not.toBe(payloadHash(payloadFor(), MODEL_ID));
  });

  it("changes when the averaging mode changes", () => {
    const averaged = buildInterpretPayload(resultFor("roa"), ratio("roa") ?? null, "average");
    const ending = buildInterpretPayload(resultFor("roa"), ratio("roa") ?? null, "ending");
    expect(payloadHash(averaged, MODEL_ID)).not.toBe(payloadHash(ending, MODEL_ID));
  });

  it("changes when the model changes", () => {
    expect(payloadHash(payloadFor(), MODEL_ID)).not.toBe(payloadHash(payloadFor(), "other-model"));
  });
});

function apiReturning(response: unknown): { api: InterpretApi; calls: unknown[] } {
  const calls: unknown[] = [];
  const api: InterpretApi = {
    messages: {
      parse: async (body) => {
        calls.push(body);
        return response as Awaited<ReturnType<InterpretApi["messages"]["parse"]>>;
      },
    },
  };
  return { api, calls };
}

const goodResponse = {
  stop_reason: "end_turn",
  stop_details: null,
  parsed_output: { text: "Net margin rose from 14.0% to 14.0%.", declined: false, reason: null },
  usage: { input_tokens: 500, output_tokens: 60 },
};

describe("the call", () => {
  it("sends the request shape this model requires", async () => {
    const { api, calls } = apiReturning(goodResponse);
    await interpretRatio(payloadFor(), api);

    const body = calls[0] as Record<string, unknown>;
    expect(body.model).toBe("claude-opus-5");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body).not.toHaveProperty("budget_tokens");
    expect(JSON.stringify(body)).not.toContain("budget_tokens");
    const outputConfig = body.output_config as Record<string, unknown>;
    expect(outputConfig).toHaveProperty("format");
    expect(body).not.toHaveProperty("output_format");
  });

  it("returns the text and the token counts", async () => {
    const { api } = apiReturning(goodResponse);
    const result = await interpretRatio(payloadFor(), api);
    expect(result.text).toContain("Net margin");
    expect(result.declined).toBe(false);
    expect(result.tokensIn).toBe(500);
    expect(result.tokensOut).toBe(60);
  });

  it("treats a declined generation as a value, not an error", async () => {
    const { api } = apiReturning({
      ...goodResponse,
      parsed_output: { text: "", declined: true, reason: "Only one period has a value." },
    });
    const result = await interpretRatio(payloadFor(), api);
    expect(result.declined).toBe(true);
    expect(result.reason).toBe("Only one period has a value.");
  });

  it("fails loudly when the model returns nothing parsable", async () => {
    const { api } = apiReturning({ ...goodResponse, parsed_output: null });
    await expect(interpretRatio(payloadFor(), api)).rejects.toThrow(/no parsable/i);
  });

  it("reports a refusal as a refusal", async () => {
    const { api } = apiReturning({
      ...goodResponse,
      stop_reason: "refusal",
      stop_details: { category: "cyber" },
      parsed_output: null,
    });
    await expect(interpretRatio(payloadFor(), api)).rejects.toThrow(/declined/i);
  });

  it("lets an API error through rather than inventing a reading", async () => {
    const api: InterpretApi = {
      messages: { parse: vi.fn().mockRejectedValue(new Error("503 upstream")) },
    };
    await expect(interpretRatio(payloadFor(), api)).rejects.toThrow(/503/);
  });
});

describe("the schema", () => {
  it("accepts a well-formed reading", () => {
    expect(InterpretationSchema.safeParse({ text: "It rose.", declined: false, reason: null }).success).toBe(
      true,
    );
  });

  it("rejects a reading with no declined flag", () => {
    expect(InterpretationSchema.safeParse({ text: "It rose." }).success).toBe(false);
  });

  it("pins the prompt version so a cache built on old wording is not reused", () => {
    expect(INTERPRET_PROMPT_VERSION).toBeGreaterThanOrEqual(1);
  });
});
