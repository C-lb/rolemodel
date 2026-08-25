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
  chunkErrors: { label: string; message: string }[];
}

export async function extractDocument(
  doc: IngestedDocument,
  call: ClaudeCaller,
): Promise<ExtractionOutput> {
  const chunks = chunkDocument(doc);
  if (chunks.length === 0) {
    throw new Error("There was nothing in this document to extract.");
  }

  const settled = await Promise.allSettled(chunks.map((chunk) => call(chunk)));

  const figures: ExtractedFigure[] = [];
  const chunkErrors: { label: string; message: string }[] = [];
  let tokensIn = 0;
  let tokensOut = 0;

  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      chunkErrors.push({ label: chunks[i].label, message: (outcome.reason as Error).message });
      continue;
    }
    figures.push(...outcome.value.result.figures);
    tokensIn += outcome.value.tokensIn;
    tokensOut += outcome.value.tokensOut;
  }

  if (figures.length === 0) {
    const detail = chunkErrors.map((e) => `${e.label}: ${e.message}`).join("; ");
    throw new Error(`Extraction produced no figures. ${detail || "The document may not contain financial statements."}`);
  }

  return { ...mergeFigures(figures), usage: { tokensIn, tokensOut }, chunkErrors };
}
