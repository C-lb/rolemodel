import { describe, it, expect } from "vitest";
import { buildWorkspace, type WorkspaceInput } from "./workspace";
import { computeRatios } from "./ratios/compute";
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

describe("forecast layer", () => {
  function forecastValueAt(data: Record<string, Record<string, number>>) {
    return (key: string, period: string) => data[period]?.[key];
  }

  it("behaves exactly as before when no forecast layer is given", () => {
    const ws = buildWorkspace(input());
    expect(ws.periods).toEqual(["FY2024"]);
    expect(ws.cell("revenue", "FY2024")).toEqual({
      canonicalKey: "revenue",
      periodKey: "FY2024",
      value: 1000,
      source: "extracted",
      extractedValue: 1000,
      confidence: 0.9,
      provenance: prov,
    });
    expect(ws.findings.map((f) => f.code).sort()).toEqual(["missing_statement", "missing_statement"]);
    expect(ws.findings.every((f) => f.severity === "warning")).toBe(true);
  });

  it("dedupes rather than duplicating a period key present in both lists", () => {
    const ws = buildWorkspace(input({
      periods: ["FY2024"],
      forecast: { periods: ["FY2024", "FY2025"], valueAt: forecastValueAt({}) },
    }));
    expect(ws.periods).toEqual(["FY2025", "FY2024"]);
  });

  it("includes the forecast keys in periods, sorted most recent first", () => {
    const ws = buildWorkspace(input({
      periods: ["FY2023", "FY2024"],
      forecast: { periods: ["FY2026", "FY2025"], valueAt: forecastValueAt({}) },
    }));
    expect(ws.periods).toEqual(["FY2026", "FY2025", "FY2024", "FY2023"]);
  });

  it("resolves a forecast cell from the layer with no provenance, confidence or extracted value", () => {
    const ws = buildWorkspace(input({
      forecast: {
        periods: ["FY2025"],
        valueAt: forecastValueAt({ FY2025: { revenue: 5000 } }),
      },
    }));
    const cell = ws.cell("revenue", "FY2025");
    expect(cell.value).toBe(5000);
    expect(cell.source).toBe("forecast");
    expect(cell.extractedValue).toBeUndefined();
    expect(cell.confidence).toBeUndefined();
    expect(cell.provenance).toBeUndefined();
  });

  it("never lets an override shadow a forecast cell", () => {
    const ws = buildWorkspace(input({
      forecast: {
        periods: ["FY2025"],
        valueAt: forecastValueAt({ FY2025: { revenue: 5000 } }),
      },
      overrides: [{ canonicalKey: "revenue", periodKey: "FY2025", value: 9999 }],
    }));
    const cell = ws.cell("revenue", "FY2025");
    expect(cell.value).toBe(5000);
    expect(cell.source).toBe("forecast");
  });

  it("leaves a historical cell unaffected by the presence of a forecast layer", () => {
    const withoutLayer = buildWorkspace(input());
    const withLayer = buildWorkspace(input({
      forecast: { periods: ["FY2025"], valueAt: forecastValueAt({ FY2025: { revenue: 5000 } }) },
    }));
    expect(withLayer.cell("revenue", "FY2024")).toEqual(withoutLayer.cell("revenue", "FY2024"));
  });

  it("does not run M1's validation gate over forecast periods", () => {
    // Decision: `validate()` runs only over the historical period list. Forecast
    // periods are the forecast engine's own responsibility (spec 5.6's forecast_*
    // codes), not M1's balance-sheet/cash-flow/subtotal checks on computed cells.
    const ws = buildWorkspace(input({
      facts: [
        { canonicalKey: "total_assets", periodKey: "FY2024", value: 1000, confidence: 1, provenance: prov },
        { canonicalKey: "total_liabilities", periodKey: "FY2024", value: 600, confidence: 1, provenance: prov },
        { canonicalKey: "total_equity", periodKey: "FY2024", value: 400, confidence: 1, provenance: prov },
      ],
      forecast: {
        // Deliberately unbalanced: if M1's balance check ran over this period it would fire.
        periods: ["FY2025"],
        valueAt: forecastValueAt({
          FY2025: { total_assets: 1000, total_liabilities: 1, total_equity: 1 },
        }),
      },
    }));
    expect(ws.findings.some((f) => f.periodKey === "FY2025")).toBe(false);
  });

  it("hands computeRatios a workspace whose forecast periods carry ratio values, leaving historical values identical", () => {
    const facts = [
      { canonicalKey: "revenue", periodKey: "FY2024", value: 1000, confidence: 0.9, provenance: prov },
      { canonicalKey: "total_assets", periodKey: "FY2024", value: 2000, confidence: 0.9, provenance: prov },
    ];
    const withoutLayer = buildWorkspace({ periods: ["FY2024"], facts, overrides: [] });
    const withLayer = buildWorkspace({
      periods: ["FY2024"],
      facts,
      overrides: [],
      forecast: {
        periods: ["FY2025"],
        valueAt: forecastValueAt({ FY2025: { revenue: 1100, total_assets: 2200 } }),
      },
    });

    const baseline = computeRatios({ workspace: withoutLayer, mode: "ending", custom: [] });
    const withForecast = computeRatios({ workspace: withLayer, mode: "ending", custom: [] });

    const baselineTurnover = baseline.find((r) => r.key === "asset_turnover")!;
    const forecastTurnover = withForecast.find((r) => r.key === "asset_turnover")!;

    const historicalBefore = baselineTurnover.periods.find((p) => p.periodKey === "FY2024");
    const historicalAfter = forecastTurnover.periods.find((p) => p.periodKey === "FY2024");
    expect(historicalAfter).toEqual(historicalBefore);

    const forecastPeriod = forecastTurnover.periods.find((p) => p.periodKey === "FY2025");
    expect(forecastPeriod?.state).toBe("ok");
    expect(forecastPeriod?.value).toBeCloseTo(1100 / 2200);
  });
});
