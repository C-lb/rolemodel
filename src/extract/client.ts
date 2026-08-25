import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ExtractionSchema, type ExtractionResult } from "./schema";
import { SYSTEM_PROMPT, buildUserPrompt, type ExtractionChunk } from "./prompt";

export const MODEL_ID = "claude-opus-5";

/** Caps thinking and output together on this model, so it has to be generous. */
const MAX_TOKENS = 32000;

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

export class ExtractionTruncatedError extends Error {
  readonly code = "truncated";
  constructor(readonly label: string) {
    super(
      `Too many figures to return in one response for ${label}. Re-run over a narrower page range, or upload just the statement pages.`,
    );
    this.name = "ExtractionTruncatedError";
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

/**
 * One upload per PDF, shared by every chunk of that document.
 *
 * `chunkDocument` hands every chunk of a document the same `doc.bytes` instance, so the buffer
 * identity is a safe key. Caching the promise (not the id) means concurrent chunks await one
 * upload rather than racing to make several. Entries die with the buffer.
 */
const uploads = new WeakMap<Buffer, Promise<string>>();

function uploadPdf(bytes: Buffer, filename: string): Promise<string> {
  const existing = uploads.get(bytes);
  if (existing) return existing;

  const pending = (async () => {
    const file = await toFile(bytes, filename, { type: "application/pdf" });
    const meta = await getClient().files.upload({ file });
    return meta.id;
  })();

  // A failed upload must not be cached, or every later chunk inherits the same failure.
  pending.catch(() => uploads.delete(bytes));
  uploads.set(bytes, pending);
  return pending;
}

export async function callClaude(chunk: ExtractionChunk): Promise<CallResult> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (chunk.pdfBytes) {
    const fileId = await uploadPdf(chunk.pdfBytes, chunk.pdfFilename ?? "document.pdf");
    content.push({ type: "document", source: { type: "file", file_id: fileId } });
  }
  content.push({ type: "text", text: buildUserPrompt(chunk) });

  const response = await getClient().messages.parse({
    model: MODEL_ID,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    output_config: { effort: "medium", format: zodOutputFormat(ExtractionSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new ExtractionRefusedError(response.stop_details?.category ?? null);
  }
  if (response.stop_reason === "max_tokens") {
    throw new ExtractionTruncatedError(chunk.label);
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
