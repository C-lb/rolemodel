import { describe, it, expect } from "vitest";
import { ingest, MAX_BYTES } from "./index";

describe("ingest", () => {
  it("rejects an unsupported extension by code", async () => {
    await expect(ingest("notes.txt", Buffer.from("hi"))).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("reads a CSV into the spreadsheet shape", async () => {
    const doc = await ingest("statements.csv", Buffer.from("Line item,FY2024\nRevenue,1000\n"));
    expect(doc.kind).toBe("spreadsheet");
    expect(doc.sheets?.[0].rows[1]).toEqual(["Revenue", 1000]);
  });

  it("rejects legacy .xls rather than promising a format it cannot read", async () => {
    await expect(ingest("old.xls", Buffer.from("hi"))).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("names only formats it can actually read in the unsupported-type message", async () => {
    const message = await ingest("notes.txt", Buffer.from("hi")).then(
      () => "",
      (e: Error) => e.message,
    );
    expect(message).toContain(".xlsx");
    expect(message).toContain(".csv");
    expect(message).not.toContain(".xls,");
  });

  it("rejects a file over the size limit before parsing it", async () => {
    const big = Buffer.alloc(MAX_BYTES + 1);
    await expect(ingest("huge.pdf", big)).rejects.toMatchObject({ code: "too_large" });
  });

  it("rejects a PDF with no text layer", async () => {
    // A structurally valid but text-free single-page PDF.
    const minimal = Buffer.from(
      "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 99 99]>>endobj\n" +
        "trailer<</Root 1 0 R>>",
      "latin1",
    );
    await expect(ingest("blank.pdf", minimal)).rejects.toMatchObject({
      code: expect.stringMatching(/no_text_layer|unreadable/),
    });
  });
});
