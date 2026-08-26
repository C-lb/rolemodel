import crypto from "node:crypto";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { RatioDef, RatioDirection, RatioUnit, AveragingMode } from "@/model/ratios/types";
import type { RatioResult } from "@/model/ratios/compute";
import { MODEL_ID, MissingApiKeyError } from "./client";

/**
 * The situational half of interpretation: a short read of what the computed numbers did.
 *
 * The payload is the whole contract. It carries computed values, period labels and the
 * authored definition, and nothing the extractor saw: no document text, no raw labels, no
 * provenance. That is what keeps the output grounded in arithmetic the user can check
 * rather than in a document the model half-remembers.
 */

export const INTERPRET_PROMPT_VERSION = 1;

/** Small: this is one paragraph, and a large cap would only buy a longer refusal. */
const MAX_TOKENS = 4000;

export const InterpretationSchema = z.object({
  text: z
    .string()
    .describe("The reading of the trend, under 80 words. Empty string when declining."),
  declined: z
    .boolean()
    .describe("True when the numbers do not support any statement about movement."),
  reason: z
    .string()
    .nullable()
    .describe("Why you declined, in one sentence. Null when you did not decline."),
});

export type Interpretation = z.infer<typeof InterpretationSchema>;

export interface InterpretPeriod {
  periodKey: string;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
}

export interface InterpretPayload {
  ratioKey: string;
  label: string;
  unit: RatioUnit;
  direction: RatioDirection;
  definition: string;
  caveat: string;
  mode: AveragingMode;
  /** Chronological, oldest first. */
  periods: InterpretPeriod[];
}

export interface CallResult extends Interpretation {
  tokensIn: number;
  tokensOut: number;
}

export class InterpretationRefusedError extends Error {
  readonly code = "refused";
  constructor(readonly category: string | null) {
    super("The model declined to read this ratio.");
    this.name = "InterpretationRefusedError";
  }
}

type ParseParams = Parameters<Anthropic["messages"]["parse"]>[0];

export interface InterpretResponse {
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  parsed_output: Interpretation | null;
  usage: { input_tokens: number; output_tokens: number };
}

/** The slice of the client this module uses, so the branches are testable off-line. */
export interface InterpretApi {
  messages: { parse(body: ParseParams): Promise<InterpretResponse> };
}

let client: Anthropic | null = null;

function getClient(): InterpretApi {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingApiKeyError();
  client ??= new Anthropic();
  return client;
}

/**
 * A ratio card is a numerator over a denominator, so the payload reports both. Where the
 * expression has more than two components, the first two stand in: the model is told to
 * describe what moved, and two figures it can subtract beat six it has to guess at.
 */
function componentPair(
  result: RatioResult,
  periodKey: string,
): { numerator: number | null; denominator: number | null } {
  const period = result.periods.find((p) => p.periodKey === periodKey);
  const usable = (period?.components ?? []).filter((c) => c.usedValue !== undefined);
  return {
    numerator: usable[0]?.usedValue ?? null,
    denominator: usable[1]?.usedValue ?? null,
  };
}

export function buildInterpretPayload(
  result: RatioResult,
  def: RatioDef | null,
  mode: AveragingMode,
): InterpretPayload {
  // Results are display-ordered, most recent first. Read in that order a model describes
  // the trend backwards, so this reverses it.
  const chronological = [...result.periods].reverse();

  return {
    ratioKey: result.key,
    label: result.label,
    unit: result.unit,
    direction: result.direction,
    definition: def?.definition ?? "A ratio you defined yourself.",
    caveat: def?.caveat ?? "",
    mode,
    periods: chronological.map((period) => ({
      periodKey: period.periodKey,
      value: period.state === "ok" && period.value !== undefined ? period.value : null,
      ...componentPair(result, period.periodKey),
    })),
  };
}

function formatValue(value: number | null, unit: RatioUnit): string {
  if (value === null) return "no value";
  switch (unit) {
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "days":
      return `${value.toFixed(1)} days`;
    case "x":
      return `${value.toFixed(2)}x`;
    case "currency":
      return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
}

const BALANCE_CONVENTION: Record<AveragingMode, string> = {
  average:
    "Balance-sheet figures are the average of opening and closing balances, where a prior period exists.",
  ending: "Balance-sheet figures are ending balances.",
};

export function interpretPrompt(payload: InterpretPayload): string {
  const rows = payload.periods.map((period) => {
    const parts = [
      `${period.periodKey}: ${formatValue(period.value, payload.unit)}`,
      period.numerator === null ? null : `numerator ${period.numerator.toLocaleString("en-US")}`,
      period.denominator === null ? null : `denominator ${period.denominator.toLocaleString("en-US")}`,
    ].filter((part): part is string => part !== null);
    return `- ${parts.join(", ")}`;
  });

  return [
    `Ratio: ${payload.label}`,
    `What it measures: ${payload.definition}`,
    payload.caveat === "" ? null : `Standard caveat: ${payload.caveat}`,
    `Generally favourable direction: ${payload.direction}`,
    BALANCE_CONVENTION[payload.mode],
    "",
    "Computed values, oldest period first:",
    ...rows,
    "",
    "Write a short reading of what these numbers did. Rules:",
    "- Describe the movement and the arithmetic drivers behind it: say which of the numerator and denominator moved more, and in which direction.",
    "- Use only the numbers above. Do not mention any company, industry, event or figure that is not in this list.",
    "- Make no forecast and no statement about the future. Describe what happened, not what will happen.",
    "- If fewer than two periods have a value, decline: set declined true and give the reason. Do not describe a single point as a trend.",
    "- Stay under 80 words.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/**
 * Identity of a reading: the model, the prompt wording, the ratio, the balance convention
 * and every number shown. Change any of them and the cached text is no longer a reading of
 * what is on screen, so it has to be regenerated.
 */
export function payloadHash(payload: InterpretPayload, modelId: string): string {
  const canonical = JSON.stringify({
    modelId,
    promptVersion: INTERPRET_PROMPT_VERSION,
    ratioKey: payload.ratioKey,
    mode: payload.mode,
    periods: payload.periods.map((p) => [p.periodKey, p.value, p.numerator, p.denominator]),
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export async function interpretRatio(
  payload: InterpretPayload,
  api: InterpretApi = getClient(),
): Promise<CallResult> {
  const response = await api.messages.parse({
    model: MODEL_ID,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    system:
      "You explain financial ratios from computed numbers alone. You never introduce a fact that is not in the numbers you are given, and you decline rather than stretch.",
    messages: [{ role: "user", content: interpretPrompt(payload) }],
    output_config: { effort: "low", format: zodOutputFormat(InterpretationSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new InterpretationRefusedError(response.stop_details?.category ?? null);
  }
  if (!response.parsed_output) {
    throw new Error(`The model returned no parsable output for ${payload.label}.`);
  }

  return {
    ...response.parsed_output,
    tokensIn: response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
  };
}
