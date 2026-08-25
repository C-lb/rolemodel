import { describe, it, expect, vi } from "vitest";
import { extractDocument } from "./extract";
import type { IngestedDocument } from "@/ingest";
import type { ExtractionResult } from "./schema";

const sheetDoc: IngestedDocument = {
  kind: "spreadsheet",
  filename: "model.xlsx",
  bytes: Buffer.alloc(0),
  sheets: [
    { name: "IS", rows: [["Revenue", 1000]] },
    { name: "BS", rows: [["Total assets", 5000]] },
  ],
};

function result(over: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    periods: ["FY2024"], currency: "USD", figures: [], unmapped_labels: [], notes: "", ...over,
  };
}

function figure(key: string, value: number) {
  return {
    canonical_key: key, raw_label: key, raw_value: String(value), value,
    scale_factor: 1, scale_evidence: "", sign_flipped: false, period_key: "FY2024",
    page: null, sheet: "IS", locator: "row 1", confidence: 0.9,
  };
}

describe("extractDocument", () => {
  it("sends one chunk per sheet and merges the figures", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ result: result({ figures: [figure("revenue", 1000)] }), tokensIn: 10, tokensOut: 5 })
      .mockResolvedValueOnce({ result: result({ figures: [figure("total_assets", 5000)] }), tokensIn: 12, tokensOut: 6 });

    const out = await extractDocument(sheetDoc, call);

    expect(call).toHaveBeenCalledTimes(2);
    expect(out.facts.map((f) => f.canonicalKey).sort()).toEqual(["revenue", "total_assets"]);
    expect(out.usage).toEqual({ tokensIn: 22, tokensOut: 11 });
  });

  it("keeps the figures from surviving chunks when one chunk fails", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ result: result({ figures: [figure("revenue", 1000)] }), tokensIn: 1, tokensOut: 1 })
      .mockRejectedValueOnce(new Error("overloaded"));

    const out = await extractDocument(sheetDoc, call);

    expect(out.facts).toHaveLength(1);
    expect(out.chunkErrors).toEqual([{ label: "sheet BS", message: "overloaded" }]);
  });

  it("throws when every chunk fails", async () => {
    const call = vi.fn().mockRejectedValue(new Error("overloaded"));
    await expect(extractDocument(sheetDoc, call)).rejects.toThrow(/no figures/i);
  });

  it("throws when the document yields no chunks", async () => {
    const empty: IngestedDocument = { kind: "spreadsheet", filename: "e.xlsx", bytes: Buffer.alloc(0), sheets: [] };
    await expect(extractDocument(empty, vi.fn())).rejects.toThrow(/nothing in this document/i);
  });
});
