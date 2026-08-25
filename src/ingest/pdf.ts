import { extractText, getDocumentProxy } from "unpdf";
import { IngestError, type PdfPage } from "./types";

export async function readPdf(bytes: Buffer): Promise<PdfPage[]> {
  let pageTexts: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const result = await extractText(pdf, { mergePages: false });
    pageTexts = result.text as string[];
  } catch (cause) {
    const message = (cause as Error).message ?? "";
    if (/password|encrypt/i.test(message)) {
      throw new IngestError("encrypted_pdf", "This PDF is password-protected. Remove the password and re-upload.");
    }
    throw new IngestError("unreadable", `Could not read the PDF: ${message}`);
  }

  const pages: PdfPage[] = pageTexts.map((text, i) => ({ pageNumber: i + 1, text: text.trim() }));
  const totalChars = pages.reduce((n, p) => n + p.text.length, 0);
  if (totalChars < 200) {
    throw new IngestError(
      "no_text_layer",
      "This PDF has no extractable text — it is probably a scan. Run OCR on it first, or upload the statements as a spreadsheet.",
    );
  }
  return pages;
}
