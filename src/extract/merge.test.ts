import { describe, it, expect } from "vitest";
import { mergeFigures } from "./merge";
import type { ExtractedFigure } from "./schema";

function figure(over: Partial<ExtractedFigure> = {}): ExtractedFigure {
  return {
    canonical_key: "revenue", raw_label: "Revenue", raw_value: "1,000", value: 1000,
    scale_factor: 1000, scale_evidence: "(in thousands)", sign_flipped: false,
    period_key: "FY2024", page: 5, sheet: null, locator: "row 1", confidence: 0.9,
    ...over,
  };
}

describe("mergeFigures", () => {
  it("keeps one fact per key and period", () => {
    const out = mergeFigures([figure(), figure({ canonical_key: "net_income", value: 200 })]);
    expect(out.facts).toHaveLength(2);
    expect(out.conflicts).toHaveLength(0);
  });

  it("treats identical values from two chunks as one fact, not a conflict", () => {
    const out = mergeFigures([figure(), figure({ page: 6 })]);
    expect(out.facts).toHaveLength(1);
    expect(out.conflicts).toHaveLength(0);
  });

  it("records a conflict when the same key and period disagree", () => {
    const out = mergeFigures([figure({ value: 1000 }), figure({ value: 1200 })]);
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0].candidates).toHaveLength(2);
  });

  it("keeps the higher-confidence candidate as the active fact on conflict", () => {
    const out = mergeFigures([
      figure({ value: 1000, confidence: 0.4 }),
      figure({ value: 1200, confidence: 0.95 }),
    ]);
    expect(out.facts[0].value).toBe(1200);
  });

  it("drops unmapped figures from facts but reports their labels", () => {
    const out = mergeFigures([figure({ canonical_key: "unmapped", raw_label: "Weird line" })]);
    expect(out.facts).toHaveLength(0);
    expect(out.unmappedLabels).toContain("Weird line");
  });

  it("drops figures whose canonical key is not in the taxonomy", () => {
    const out = mergeFigures([figure({ canonical_key: "made_up_key", raw_label: "Ghost" })]);
    expect(out.facts).toHaveLength(0);
    expect(out.unmappedLabels).toContain("Ghost");
  });

  it("collects the union of periods, most recent first", () => {
    const out = mergeFigures([figure({ period_key: "FY2023" }), figure({ period_key: "FY2024", canonical_key: "net_income" })]);
    expect(out.periods).toEqual(["FY2024", "FY2023"]);
  });
});
