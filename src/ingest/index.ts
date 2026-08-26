import path from "node:path";
import { readPdf } from "./pdf";
import { readCsv, readSpreadsheet } from "./spreadsheet";
import { IngestError, MAX_BYTES, type IngestedDocument } from "./types";

export * from "./types";

export async function ingest(filename: string, bytes: Buffer): Promise<IngestedDocument> {
  if (bytes.length > MAX_BYTES) {
    throw new IngestError(
      "too_large",
      `That file is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_BYTES / 1024 / 1024} MB.`,
    );
  }

  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") {
    return { kind: "pdf", filename, bytes, pages: await readPdf(bytes) };
  }
  if (ext === ".xlsx" || ext === ".xlsm") {
    return { kind: "spreadsheet", filename, bytes, sheets: await readSpreadsheet(bytes) };
  }
  if (ext === ".csv") {
    return { kind: "spreadsheet", filename, bytes, sheets: await readCsv(bytes) };
  }
  // Legacy .xls is deliberately absent: it is the BIFF binary format, which the
  // reader here cannot open, and promising it only produced an unreadable file.
  throw new IngestError(
    "unsupported_type",
    `${ext || "That file"} is not supported. Upload a PDF (.pdf), an Excel workbook (.xlsx, .xlsm) or a CSV (.csv).`,
  );
}
