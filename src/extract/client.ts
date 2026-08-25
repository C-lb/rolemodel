import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ExtractionSchema, type ExtractionResult } from "./schema";
import { SYSTEM_PROMPT, buildUserPrompt, type ExtractionChunk } from "./prompt";

export const MODEL_ID = "claude-opus-5";

export class MissingApiKeyError extends Error {
  readonly code = "missing_api_key";
  constructor() {
    super("ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the server.");
    this.name = "MissingApiKeyError";
  }
}

export class ExtractionRefusedError extends Error {
  readonly code = "refused";
  constructor(readonly category: string | null) {
    super("The model declined to process this document.");
    this.name = "ExtractionRefusedError";
  }
}

export interface CallResult {
  result: ExtractionResult;
  tokensIn: number;
  tokensOut: number;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingApiKeyError();
  client ??= new Anthropic();
  return client;
}

export async function callClaude(chunk: ExtractionChunk): Promise<CallResult> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (chunk.pdfBytes) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: chunk.pdfBytes.toString("base64"),
      },
    });
  }
  content.push({ type: "text", text: buildUserPrompt(chunk) });

  const response = await getClient().messages.parse({
    model: MODEL_ID,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new ExtractionRefusedError(response.stop_details?.category ?? null);
  }
  if (!response.parsed_output) {
    throw new Error(`Extraction returned no parsable output for ${chunk.label}.`);
  }

  return {
    result: response.parsed_output,
    tokensIn: response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
  };
}
