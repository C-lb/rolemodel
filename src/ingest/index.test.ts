import { describe, it, expect } from "vitest";
import { ingest, MAX_BYTES } from "./index";

describe("ingest", () => {
  it("rejects an unsupported extension by code", async () => {
    await expect(ingest("notes.txt", Buffer.from("hi"))).rejects.toMatchObject({ code: "unsupported_type" });
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
