import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  callClaude,
  MODEL_ID,
  MissingApiKeyError,
  ExtractionRefusedError,
  ExtractionTruncatedError,
  type ClaudeApi,
  type ClaudeResponse,
} from "./client";
import { ExtractionSchema, type ExtractionResult } from "./schema";
import type { ExtractionChunk } from "./prompt";

type ParseParams = Parameters<ClaudeApi["messages"]["parse"]>[0];

const result: ExtractionResult = {
  periods: ["FY2024"],
  currency: "USD",
  figures: [],
  unmapped_labels: [],
  notes: "",
};

const ok: ClaudeResponse = {
  stop_reason: "end_turn",
  parsed_output: result,
  usage: { input_tokens: 11, output_tokens: 22 },
};

/** Stands in for the network. Records the request so the constraints can be asserted against it. */
function fakeApi(response: ClaudeResponse = ok, uploadId = "file_123") {
  const requests: ParseParams[] = [];
  const upload = vi.fn(async () => ({ id: uploadId }));
  const api: ClaudeApi = {
    files: { upload },
    messages: {
      parse: async (body) => {
        requests.push(body);
        return response;
      },
    },
  };
  return { api, requests, upload };
}

const chunk: ExtractionChunk = { label: "Sheet1", text: "Revenue 1,000" };

describe("callClaude request shape", () => {
  it("names the model exactly, with no date suffix", async () => {
    const { api, requests } = fakeApi();
    await callClaude(chunk, api);
    expect(requests[0].model).toBe("claude-opus-5");
    expect(MODEL_ID).toBe("claude-opus-5");
  });

  it("asks for adaptive thinking and never sends budget_tokens", async () => {
    // budget_tokens returns a 400 on this model, so its absence is a constraint,
    // not a preference. Checked over the whole body: it is invalid anywhere.
    const { api, requests } = fakeApi();
    await callClaude(chunk, api);
    expect(requests[0].thinking).toEqual({ type: "adaptive" });
    expect(JSON.stringify(requests[0])).not.toContain("budget_tokens");
  });

  it("passes the schema through zodOutputFormat in output_config.format", async () => {
    const { api, requests } = fakeApi();
    await callClaude(chunk, api);
    const body = requests[0] as ParseParams & { output_format?: unknown };
    // The helper attaches its own `parse` function, which no two calls share, so the
    // wire-visible half is what gets compared.
    const expected = zodOutputFormat(ExtractionSchema);
    expect(JSON.parse(JSON.stringify(body.output_config?.format)))
      .toEqual(JSON.parse(JSON.stringify(expected)));
    expect(typeof (body.output_config?.format as { parse?: unknown } | undefined)?.parse).toBe("function");
    // The deprecated top-level parameter must not be used.
    expect(body.output_format).toBeUndefined();
  });

  it("sends the chunk text as the user content", async () => {
    const { api, requests } = fakeApi();
    await callClaude(chunk, api);
    expect(JSON.stringify(requests[0].messages)).toContain("Revenue 1,000");
  });

  it("returns the parsed output and the token usage", async () => {
    const { api } = fakeApi();
    await expect(callClaude(chunk, api)).resolves.toEqual({
      result, tokensIn: 11, tokensOut: 22,
    });
  });
});

describe("callClaude PDF upload", () => {
  it("uploads the PDF once and references it by file id", async () => {
    const { api, upload, requests } = fakeApi();
    const pdf: ExtractionChunk = {
      label: "pages 1-2", text: "", pdfBytes: Buffer.from("%PDF-1.4 one"), pdfFilename: "acme.pdf", pages: [1, 2],
    };

    await callClaude(pdf, api);
    await callClaude({ ...pdf, label: "pages 3-4", pages: [3, 4] }, api);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(requests[0].messages)).toContain("file_123");
  });

  it("does not cache a failed upload", async () => {
    const upload = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValue({ id: "file_9" });
    const api: ClaudeApi = { files: { upload }, messages: { parse: async () => ok } };
    const pdf: ExtractionChunk = { label: "p1", text: "", pdfBytes: Buffer.from("%PDF-1.4 two"), pdfFilename: "a.pdf" };

    await expect(callClaude(pdf, api)).rejects.toThrow(/network down/);
    await expect(callClaude(pdf, api)).resolves.toBeTruthy();
    expect(upload).toHaveBeenCalledTimes(2);
  });
});

describe("callClaude failure branches", () => {
  it("turns a refusal into a typed error carrying the category", async () => {
    const { api } = fakeApi({
      ...ok, stop_reason: "refusal", stop_details: { category: "cyber" }, parsed_output: null,
    });
    const error = await callClaude(chunk, api).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionRefusedError);
    expect((error as ExtractionRefusedError).category).toBe("cyber");
    expect((error as ExtractionRefusedError).code).toBe("refused");
  });

  it("survives a refusal with no stop_details", async () => {
    const { api } = fakeApi({ ...ok, stop_reason: "refusal", parsed_output: null });
    const error = await callClaude(chunk, api).then(() => null, (e: unknown) => e);
    expect((error as ExtractionRefusedError).category).toBeNull();
  });

  it("turns a truncated response into a typed error naming the chunk", async () => {
    const { api } = fakeApi({ ...ok, stop_reason: "max_tokens", parsed_output: null });
    const error = await callClaude(chunk, api).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionTruncatedError);
    expect((error as ExtractionTruncatedError).code).toBe("truncated");
    expect((error as Error).message).toContain("Sheet1");
  });

  it("guards parsed_output rather than trusting it", async () => {
    const { api } = fakeApi({ ...ok, parsed_output: null });
    await expect(callClaude(chunk, api)).rejects.toThrow(/no parsable output for Sheet1/);
  });
});

describe("callClaude without an injected client", () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it("reports a missing API key instead of building a client without one", async () => {
    const error = await callClaude(chunk).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(MissingApiKeyError);
    expect((error as MissingApiKeyError).code).toBe("missing_api_key");
  });
});
