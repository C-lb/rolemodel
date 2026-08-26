import { describe, it, expect } from "vitest";
import { ExtractedFigureSchema, ExtractionSchema } from "./schema";

function figure(over: Record<string, unknown> = {}) {
  return {
    canonical_key: "revenue", raw_label: "Revenue", raw_value: "1,000", value: 1000,
    scale_factor: 1000, scale_evidence: "(in thousands)", sign_flipped: false,
    period_key: "FY2024", page: 5, sheet: null, locator: "row 1", confidence: 0.9,
    ...over,
  };
}

describe("ExtractionSchema period keys", () => {
  it("accepts the two orderable shapes", () => {
    for (const key of ["FY2024", "Q2-2025"]) {
      expect(ExtractedFigureSchema.safeParse(figure({ period_key: key })).success, key).toBe(true);
    }
  });

  it("rejects a period key the model layer could not rank", () => {
    // Each of these is plausible from a filing header, and each would collapse the
    // period sort to insertion order if it were let through.
    for (const key of ["FY24", "2024", "Q2 2025", "Q5-2025", ""]) {
      expect(ExtractedFigureSchema.safeParse(figure({ period_key: key })).success, key).toBe(false);
    }
  });

  it("rejects a malformed key in the document-level period list too", () => {
    const base = { currency: "USD", figures: [], unmapped_labels: [], notes: "" };
    expect(ExtractionSchema.safeParse({ ...base, periods: ["FY2024"] }).success).toBe(true);
    expect(ExtractionSchema.safeParse({ ...base, periods: ["FY2024", "FY24"] }).success).toBe(false);
  });
});
