import type { IngestedDocument } from "@/ingest";
import { chunkDocument, type ExtractionChunk } from "./prompt";
import { mergeFigures, type MergeOutput } from "./merge";
import type { ExtractedFigure, ExtractionResult } from "./schema";

export type ClaudeCaller = (chunk: ExtractionChunk) => Promise<{
  result: ExtractionResult;
  tokensIn: number;
  tokensOut: number;
}>;

export interface ExtractionOutput extends MergeOutput {
  usage: { tokensIn: number; tokensOut: number };
  chunkErrors: { label: string; message: string; code?: string }[];
}

/**
 * Thrown when no chunk produced a usable figure. Carries `code` when every failing chunk agrees
 * on one (e.g. every chunk hit the same missing-API-key error), so callers can show remediation
 * specific to that failure rather than a generic message.
 */
export class ExtractionFailedError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "ExtractionFailedError";
  }
}

export async function extractDocument(
  doc: IngestedDocument,
  call: ClaudeCaller,
): Promise<ExtractionOutput> {
  const chunks = chunkDocument(doc);
  if (chunks.length === 0) {
    throw new ExtractionFailedError("There was nothing in this document to extract.");
  }

  const settled = await Promise.allSettled(chunks.map((chunk) => call(chunk)));

  const figures: ExtractedFigure[] = [];
  const chunkErrors: { label: string; message: string; code?: string }[] = [];
  let tokensIn = 0;
  let tokensOut = 0;

  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      const reason = outcome.reason as Error & { code?: string };
      chunkErrors.push({ label: chunks[i].label, message: reason.message, code: reason.code });
      continue;
    }
    figures.push(...outcome.value.result.figures);
    tokensIn += outcome.value.tokensIn;
    tokensOut += outcome.value.tokensOut;
  }

  if (figures.length === 0) {
    const detail = chunkErrors.map((e) => `${e.label}: ${e.message}`).join("; ");
    // Only attach a code when EVERY failing chunk agrees on it — a code shared by some but not
    // all chunks describes just part of the failure, not the failure as a whole.
    const allShareACode = chunkErrors.length > 0 && chunkErrors.every((e) => e.code !== undefined && e.code === chunkErrors[0].code);
    const code = allShareACode ? chunkErrors[0].code : undefined;
    throw new ExtractionFailedError(
      `Extraction produced no figures. ${detail || "The document may not contain financial statements."}`,
      code,
    );
  }

  return { ...mergeFigures(figures), usage: { tokensIn, tokensOut }, chunkErrors };
}
