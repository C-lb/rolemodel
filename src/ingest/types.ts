export type IngestKind = "pdf" | "spreadsheet";

export interface PdfPage {
  pageNumber: number;
  text: string;
}

export interface SheetGrid {
  name: string;
  rows: (string | number | null)[][];
}

export interface IngestedDocument {
  kind: IngestKind;
  filename: string;
  bytes: Buffer;
  pages?: PdfPage[];
  sheets?: SheetGrid[];
}

/**
 * Single source of truth for the failures ingest can report. Every code here must
 * carry remediation copy the user can act on — asserted by a test in `src/server`.
 */
export const INGEST_ERROR_CODES = [
  "unsupported_type",
  "too_large",
  "encrypted_pdf",
  "no_text_layer",
  "empty_workbook",
  "unreadable",
] as const;

export type IngestErrorCode = (typeof INGEST_ERROR_CODES)[number];

export class IngestError extends Error {
  constructor(readonly code: IngestErrorCode, message: string) {
    super(message);
    this.name = "IngestError";
  }
}

export const MAX_BYTES = 30 * 1024 * 1024;
