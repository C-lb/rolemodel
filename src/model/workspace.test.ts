import { describe, it, expect } from "vitest";
import { buildWorkspace, type WorkspaceInput } from "./workspace";
import type { Provenance } from "@/db/schema";

const prov: Provenance = {
  page: 3, sheet: null, locator: "row 2", rawLabel: "Net revenue", rawValue: "1,000",
  scaleFactor: 1000, scaleEvidence: "(in thousands)", signFlipped: false,
};

function input(over: Partial<WorkspaceInput> = {}): WorkspaceInput {
  return {
    periods: ["FY2024"],
    facts: [{ canonicalKey: "revenue", periodKey: "FY2024", value: 1000, confidence: 0.9, provenance: prov }],
    overrides: [],
    ...over,
  };
}

describe("buildWorkspace", () => {
  it("exposes an extracted fact as a cell with its provenance", () => {
    const cell = buildWorkspace(input()).cell("revenue", "FY2024");
    expect(cell.value).toBe(1000);
    expect(cell.source).toBe("extracted");
    expect(cell.provenance?.page).toBe(3);
  });

  it("shadows an extracted value with an override and keeps the original visible", () => {
    const ws = buildWorkspace(input({
      overrides: [{ canonicalKey: "revenue", periodKey: "FY2024", value: 1234 }],
    }));
    const cell = ws.cell("revenue", "FY2024");
    expect(cell.value).toBe(1234);
    expect(cell.source).toBe("override");
    expect(cell.extractedValue).toBe(1000);
    expect(cell.provenance?.rawValue).toBe("1,000");
  });

  it("supports an override on a line item that was never extracted", () => {
    const ws = buildWorkspace(input({
      overrides: [{ canonicalKey: "inventory", periodKey: "FY2024", value: 50 }],
    }));
    const cell = ws.cell("inventory", "FY2024");
    expect(cell.value).toBe(50);
    expect(cell.source).toBe("override");
    expect(cell.extractedValue).toBeUndefined();
  });

  it("reports an absent cell rather than throwing", () => {
    const cell = buildWorkspace(input()).cell("goodwill", "FY2024");
    expect(cell.value).toBeUndefined();
    expect(cell.source).toBe("absent");
  });

  it("returns statement rows in taxonomy order with one cell per period", () => {
    const ws = buildWorkspace(input({ periods: ["FY2024", "FY2023"] }));
    const rows = ws.statement("income");
    expect(rows[0].def.key).toBe("revenue");
    expect(rows[0].cells).toHaveLength(2);
    const orders = rows.map((r) => r.def.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("runs validation over override-adjusted values, not raw extracted ones", () => {
    const facts = [
      { canonicalKey: "total_assets", periodKey: "FY2024", value: 1000, confidence: 1, provenance: prov },
      { canonicalKey: "total_liabilities", periodKey: "FY2024", value: 600, confidence: 1, provenance: prov },
      { canonicalKey: "total_equity", periodKey: "FY2024", value: 1, confidence: 1, provenance: prov },
    ];
    const broken = buildWorkspace(input({ facts, overrides: [] }));
    expect(broken.findings.some((f) => f.code === "balance_sheet_imbalance")).toBe(true);

    const fixed = buildWorkspace(input({
      facts,
      overrides: [{ canonicalKey: "total_equity", periodKey: "FY2024", value: 400 }],
    }));
    expect(fixed.findings.some((f) => f.code === "balance_sheet_imbalance")).toBe(false);
  });
});
