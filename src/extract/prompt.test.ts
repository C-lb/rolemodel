import { describe, it, expect } from "vitest";
import { chunkDocument, buildUserPrompt, formatPageList } from "./prompt";
import type { IngestedDocument } from "@/ingest";

const STATEMENT = "Consolidated Balance Sheets\nTotal assets 5,000";
const FILLER = "Item 1A. Risk factors. Competition is intense.";

function pdf(pages: { pageNumber: number; text: string }[]): IngestedDocument {
  return { kind: "pdf", filename: "10k.pdf", bytes: Buffer.from("%PDF"), pages };
}

describe("formatPageList", () => {
  it("renders one, two and many pages without inventing a range", () => {
    expect(formatPageList([7])).toBe("page 7");
    expect(formatPageList([7, 9])).toBe("pages 7 and 9");
    expect(formatPageList([62, 64, 66])).toBe("pages 62, 64 and 66");
  });
});

describe("chunkDocument — pdf", () => {
  it("carries the pages it sent, and the whole pdf, on a contiguous statement run", () => {
    const doc = pdf([
      { pageNumber: 1, text: FILLER },
      { pageNumber: 2, text: STATEMENT },
      { pageNumber: 3, text: "Statements of operations\nNet income 100" },
    ]);

    const chunks = chunkDocument(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].pages).toEqual([2, 3]);
    expect(chunks[0].pdfBytes).toBe(doc.bytes);
    expect(chunks[0].pdfFilename).toBe("10k.pdf");
    expect(chunks[0].text).toContain("--- page 2 ---");
    expect(chunks[0].text).not.toContain("Risk factors");
  });

  it("names exactly the pages it sent when the statement pages are not contiguous", () => {
    const doc = pdf([
      { pageNumber: 62, text: STATEMENT },
      { pageNumber: 63, text: FILLER },
      { pageNumber: 64, text: "Net revenue 900" },
      { pageNumber: 65, text: FILLER },
      { pageNumber: 66, text: "Cash flow from operations 300" },
    ]);

    const chunks = chunkDocument(doc);
    const prompt = buildUserPrompt(chunks[0]);

    expect(chunks[0].pages).toEqual([62, 64, 66]);
    expect(chunks[0].label).toBe("pages 62, 64 and 66");
    expect(prompt).toContain("pages 62, 64 and 66");
    // The skipped pages must never be described as inside the window.
    expect(prompt).not.toContain("62 to 66");
    expect(prompt).not.toContain("page 63");
    expect(prompt).not.toContain("page 65");
  });

  it("splits long statement runs into chunks of at most six pages", () => {
    const doc = pdf(
      Array.from({ length: 8 }, (_, i) => ({ pageNumber: i + 1, text: STATEMENT })),
    );

    const chunks = chunkDocument(doc);

    expect(chunks.map((c) => c.pages)).toEqual([[1, 2, 3, 4, 5, 6], [7, 8]]);
  });

  it("falls back to every page when no page looks like a statement", () => {
    const doc = pdf([
      { pageNumber: 1, text: FILLER },
      { pageNumber: 2, text: FILLER },
    ]);

    expect(chunkDocument(doc)[0].pages).toEqual([1, 2]);
  });

  it("returns no chunks for a pdf with no pages", () => {
    expect(chunkDocument(pdf([]))).toEqual([]);
  });
});

describe("chunkDocument — spreadsheet", () => {
  it("makes one attachment-free chunk per sheet with numbered rows", () => {
    const doc: IngestedDocument = {
      kind: "spreadsheet",
      filename: "model.xlsx",
      bytes: Buffer.alloc(0),
      sheets: [
        { name: "IS", rows: [["Revenue", 1000], ["Costs", null]] },
        { name: "BS", rows: [["Total assets", 5000]] },
      ],
    };

    const chunks = chunkDocument(doc);

    expect(chunks.map((c) => c.label)).toEqual(["sheet IS", "sheet BS"]);
    expect(chunks[0].pdfBytes).toBeUndefined();
    expect(chunks[0].pages).toBeUndefined();
    expect(chunks[0].text).toContain("1\tRevenue\t1000");
    expect(chunks[0].text).toContain("2\tCosts\t");
    expect(buildUserPrompt(chunks[0])).toContain("Extract every financial-statement figure from the content below.");
  });
});
