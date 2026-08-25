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

export type IngestErrorCode =
  | "unsupported_type"
  | "too_large"
  | "encrypted_pdf"
  | "no_text_layer"
  | "empty_workbook"
  | "unreadable";

export class IngestError extends Error {
  constructor(readonly code: IngestErrorCode, message: string) {
    super(message);
    this.name = "IngestError";
  }
}

export const MAX_BYTES = 30 * 1024 * 1024;
