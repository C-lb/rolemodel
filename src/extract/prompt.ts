import { TAXONOMY } from "@/model/taxonomy";
import type { IngestedDocument } from "@/ingest";

export const PROMPT_VERSION = 1;

export interface ExtractionChunk {
  label: string;
  /** Text content for spreadsheet chunks, or a page-range description for PDF chunks. */
  text: string;
  /** Present only for PDF chunks: the whole PDF, sent as a document block. */
  pdfBytes?: Buffer;
  pageRange?: { from: number; to: number };
}

export const SYSTEM_PROMPT = [
  "You extract financial statements from source documents into a fixed canonical schema.",
  "",
  "Rules you must follow:",
  "- Report every figure exactly as printed in raw_value, then give the converted number in value.",
  "- Apply the document's stated scale exactly once. If the statement header says '(in thousands)', scale_factor is 1000 and scale_evidence quotes that header. If no scale is stated anywhere, scale_factor is 1 and scale_evidence is an empty string. Never guess a scale from the magnitude of the numbers.",
  "- A figure printed in parentheses is negative. Set sign_flipped true and make value negative.",
  "- Costs, expenses and cash outflows keep the sign convention the document uses. Do not normalise signs to make totals work.",
  "- Never invent a figure that is not printed. If a line is absent, omit it. An omitted line is correct; a fabricated one is not.",
  "- Map each label to the closest canonical key. If nothing fits, use 'unmapped' and also list the label in unmapped_labels.",
  "- Extract subtotals as printed rather than recomputing them. A subtotal that disagrees with its components is information the reviewer needs.",
  "- page is the 1-indexed page the figure is printed on. Get this right; a reader will click through to check it.",
].join("\n");

function taxonomyBlock(): string {
  return TAXONOMY.map((i) => `${i.key} [${i.statement}] — ${i.label}: ${i.definition}`).join("\n");
}

export function buildUserPrompt(chunk: ExtractionChunk): string {
  return [
    "Canonical line-item keys:",
    taxonomyBlock(),
    "",
    chunk.pageRange
      ? `Extract every financial-statement figure printed on pages ${chunk.pageRange.from} to ${chunk.pageRange.to} of the attached document. Ignore pages outside that range.`
      : "Extract every financial-statement figure from the content below.",
    "",
    chunk.text,
  ].join("\n");
}

/** Splits an ingested document into chunks small enough to extract reliably. */
export function chunkDocument(doc: IngestedDocument): ExtractionChunk[] {
  if (doc.kind === "pdf") {
    const pages = doc.pages ?? [];
    // Only pages that plausibly contain a statement are worth sending.
    const interesting = pages.filter((p) => /total (assets|liabilities)|net (income|revenue|sales)|cash (flow|and cash)|balance sheet|statements? of operations/i.test(p.text));
    const targets = interesting.length > 0 ? interesting : pages;
    const PAGES_PER_CHUNK = 6;
    const chunks: ExtractionChunk[] = [];
    for (let i = 0; i < targets.length; i += PAGES_PER_CHUNK) {
      const slice = targets.slice(i, i + PAGES_PER_CHUNK);
      chunks.push({
        label: `pages ${slice[0].pageNumber}-${slice[slice.length - 1].pageNumber}`,
        text: slice.map((p) => `--- page ${p.pageNumber} ---\n${p.text}`).join("\n\n"),
        pdfBytes: doc.bytes,
        pageRange: { from: slice[0].pageNumber, to: slice[slice.length - 1].pageNumber },
      });
    }
    return chunks;
  }

  return (doc.sheets ?? []).map((sheet) => ({
    label: `sheet ${sheet.name}`,
    text: [
      `Sheet name: ${sheet.name}`,
      "Rows, tab-separated, in order:",
      ...sheet.rows.map((row, i) => `${i + 1}\t${row.map((c) => (c === null ? "" : String(c))).join("\t")}`),
    ].join("\n"),
  }));
}
