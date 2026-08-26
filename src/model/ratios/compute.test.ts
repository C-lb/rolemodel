import { describe, it, expect } from "vitest";
import { computeRatios, dupont, type RatioPeriodResult, type RatioResult } from "./compute";
import { RATIOS } from "./library";
import { fixtureWorkspace, withoutKeys, FY2024, FY2023, type FixtureOptions } from "./fixtures";
import type { AveragingMode } from "./types";

function results(mode: AveragingMode = "average", options: FixtureOptions = {}, custom: Parameters<typeof computeRatios>[0]["custom"] = []) {
  return computeRatios({ workspace: fixtureWorkspace(options), mode, custom });
}

function pick(all: RatioResult[], key: string): RatioResult {
  const found = all.find((r) => r.key === key);
  if (!found) throw new Error(`no ratio "${key}" in the results`);
  return found;
}

function at(all: RatioResult[], key: string, period: string): RatioPeriodResult {
  const found = pick(all, key).periods.find((p) => p.periodKey === period);
  if (!found) throw new Error(`no period "${period}" for ratio "${key}"`);
  return found;
}

function value(all: RatioResult[], key: string, period = "FY2024"): number {
  const result = at(all, key, period);
  if (result.state !== "ok" || result.value === undefined) {
    throw new Error(`${key} ${period} is ${result.state}, expected a value`);
  }
  return result.value;
}

const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 6);

describe("shape", () => {
  it("returns every library ratio", () => {
    const all = results();
    expect(all).toHaveLength(RATIOS.length);
    expect(all.every((r) => r.isCustom === false)).toBe(true);
  });

  it("orders periods most recent first", () => {
    expect(pick(results(), "current_ratio").periods.map((p) => p.periodKey)).toEqual([
      "FY2024",
      "FY2023",
      "FY2022",
    ]);
  });
});

describe("ending balances", () => {
  const all = results("ending");

  it("computes the liquidity family", () => {
    close(value(all, "current_ratio"), 2.5);
    close(value(all, "quick_ratio"), 5300 / 2800);
    close(value(all, "cash_ratio"), 2500 / 2800);
    close(value(all, "working_capital"), 4200);
    close(value(all, "ocf_to_current_liabilities"), 2600 / 2800);
  });

  it("computes the leverage family", () => {
    close(value(all, "debt_to_equity"), 0.7);
    close(value(all, "debt_to_assets"), 0.35);
    close(value(all, "liabilities_to_equity"), 1);
    close(value(all, "equity_multiplier"), 2);
    close(value(all, "net_debt_to_ebitda"), 2400 / 3700);
  });

  it("computes the efficiency family", () => {
    close(value(all, "dso"), (2800 / 15000) * 365);
    close(value(all, "dio"), (1700 / 9000) * 365);
    close(value(all, "dpo"), (1400 / 9000) * 365);
    close(
      value(all, "cash_conversion_cycle"),
      (2800 / 15000) * 365 + (1700 / 9000) * 365 - (1400 / 9000) * 365,
    );
    close(value(all, "asset_turnover"), 15000 / 14000);
  });

  it("computes the profitability family", () => {
    close(value(all, "gross_margin"), 0.4);
    close(value(all, "operating_margin"), 0.2);
    close(value(all, "net_margin"), 0.14);
    close(value(all, "ebitda_margin"), 3700 / 15000);
    close(value(all, "roa"), 0.15);
    close(value(all, "roe"), 0.3);
  });

  it("computes the coverage family", () => {
    close(value(all, "interest_coverage"), 10);
    close(value(all, "ebitda_interest_coverage"), 3700 / 300);
    close(value(all, "cfo_to_debt"), 2600 / 4900);
    close(value(all, "capex_coverage"), 2.6);
  });
});

describe("average balances", () => {
  const all = results("average");

  it("averages the balance-sheet side of a flow-over-stock ratio", () => {
    close(value(all, "roa"), 2100 / 13000);
    close(value(all, "roe"), 2100 / 6500);
    close(value(all, "asset_turnover"), 15000 / 13000);
    close(value(all, "ocf_to_current_liabilities"), 2600 / 2600);
    close(value(all, "dso"), (2600 / 15000) * 365);
    close(value(all, "dio"), (1650 / 9000) * 365);
    close(value(all, "dpo"), (1300 / 9000) * 365);
    close(value(all, "cfo_to_debt"), 2600 / 4550);
    close(value(all, "net_debt_to_ebitda"), (650 + 3900 - 1350 - 900) / 3700);
  });

  it("never averages a ratio measured entirely on one date", () => {
    close(value(all, "current_ratio"), 2.5);
    close(value(all, "debt_to_equity"), 0.7);
    close(value(all, "equity_multiplier"), 2);
    close(value(all, "quick_ratio"), 5300 / 2800);
    close(value(all, "working_capital"), 4200);
  });

  it("records which components were averaged", () => {
    const roa = at(all, "roa", "FY2024");
    const assets = roa.components.find((c) => c.name === "total_assets");
    expect(assets?.averaged).toBe(true);
    expect(assets?.storedValue).toBe(14000);
    expect(assets?.usedValue).toBe(13000);
    expect(roa.components.find((c) => c.name === "net_income")?.averaged).toBe(false);
  });

  it("falls back to the ending balance in the earliest period and says so", () => {
    const earliest = at(all, "roa", "FY2022");
    close(earliest.value ?? 0, 1400 / 10000);
    expect(earliest.notes.map((n) => n.code)).toContain("averaging_fallback");
    expect(at(all, "roa", "FY2024").notes.map((n) => n.code)).not.toContain("averaging_fallback");
  });

  it("falls back when the prior period is present but not adjacent", () => {
    const gapped = results("average", { rows: { FY2024, "FY2022": FY2023 } });
    expect(at(gapped, "roa", "FY2024").notes.map((n) => n.code)).toContain("averaging_fallback");
  });
});

describe("day counts", () => {
  it("uses 365 days for a full year", () => {
    close(value(results("ending"), "dso"), (2800 / 15000) * 365);
    expect(at(results("ending"), "dso", "FY2024").dayMultiplier).toBe(365);
  });

  it("annualises a single quarter at 91.25 days and says so", () => {
    const quarterly = results("ending", { rows: { "Q1-2025": FY2024 } });
    close(value(quarterly, "dso", "Q1-2025"), (2800 / 15000) * 91.25);
    const result = at(quarterly, "dso", "Q1-2025");
    expect(result.dayMultiplier).toBe(91.25);
    expect(result.notes.map((n) => n.code)).toContain("quarterly_annualised");
  });

  it("does not scale a ratio built from figures already in days", () => {
    expect(at(results("ending"), "cash_conversion_cycle", "FY2024").dayMultiplier).toBeUndefined();
  });

  it("flags a workspace mixing annual and quarterly periods", () => {
    const mixed = results("ending", { rows: { "Q1-2025": FY2024, FY2024, FY2023 } });
    expect(at(mixed, "dso", "FY2024").notes.map((n) => n.code)).toContain("mixed_period_types");
    expect(at(mixed, "asset_turnover", "FY2024").notes.map((n) => n.code)).toContain(
      "mixed_period_types",
    );
    expect(at(mixed, "current_ratio", "FY2024").notes.map((n) => n.code)).not.toContain(
      "mixed_period_types",
    );
  });
});

describe("sign normalisation", () => {
  it("reads a negative interest expense as a magnitude", () => {
    const coverage = at(results("ending"), "interest_coverage", "FY2024");
    const interest = coverage.components.find((c) => c.name === "interest_expense");
    expect(interest?.storedValue).toBe(-300);
    expect(interest?.usedValue).toBe(300);
    expect(interest?.magnitudeApplied).toBe(true);
    close(coverage.value ?? 0, 10);
  });

  it("reads a negative capital expenditure as a magnitude", () => {
    close(value(results("ending"), "capex_coverage"), 2.6);
  });

  it("leaves a key outside the list alone", () => {
    const margin = at(results("ending"), "net_margin", "FY2024");
    expect(margin.components.every((c) => c.magnitudeApplied === false)).toBe(true);
  });
});

describe("missing and degenerate inputs", () => {
  it("names every missing line item", () => {
    const stripped = computeRatios({
      workspace: fixtureWorkspace(withoutKeys(["inventory", "cost_of_revenue"])),
      mode: "ending",
      custom: [],
    });
    const dio = at(stripped, "dio", "FY2024");
    expect(dio.state).toBe("unavailable");
    expect(dio.missing.sort()).toEqual(["cost_of_revenue", "inventory"]);
    expect(dio.value).toBeUndefined();
  });

  it("reports a zero denominator rather than a number", () => {
    const zeroed = results("ending", {
      overrides: [{ canonicalKey: "interest_expense", periodKey: "FY2024", value: 0 }],
    });
    const coverage = at(zeroed, "interest_coverage", "FY2024");
    expect(coverage.state).toBe("undefined_denominator");
    expect(coverage.denominatorReason).toBe("zero");
  });

  it("suppresses return on equity when equity is negative", () => {
    const negative = results("ending", {
      overrides: [{ canonicalKey: "total_equity", periodKey: "FY2024", value: -7000 }],
    });
    const roe = at(negative, "roe", "FY2024");
    expect(roe.state).toBe("undefined_denominator");
    expect(roe.denominatorReason).toBe("negative");
  });

  it("still computes the equity multiplier on negative equity", () => {
    const negative = results("ending", {
      overrides: [{ canonicalKey: "total_equity", periodKey: "FY2024", value: -7000 }],
    });
    close(value(negative, "equity_multiplier"), -2);
  });

  it("never produces a non-finite number anywhere", () => {
    for (const mode of ["average", "ending"] as const) {
      for (const result of results(mode)) {
        for (const period of result.periods) {
          if (period.state === "ok") {
            expect(Number.isFinite(period.value), `${result.key} ${period.periodKey}`).toBe(true);
          } else {
            expect(period.value, `${result.key} ${period.periodKey}`).toBeUndefined();
          }
        }
      }
    }
  });
});

describe("confidence and edits", () => {
  it("takes the lowest confidence across the components", () => {
    const all = results("ending", { confidence: 0.9, confidenceByKey: { revenue: 0.42 } });
    expect(at(all, "net_margin", "FY2024").confidence).toBeCloseTo(0.42, 6);
    expect(at(all, "current_ratio", "FY2024").confidence).toBeCloseTo(0.9, 6);
  });

  it("flags a card whose components include a low-confidence figure", () => {
    const all = results("ending", { confidence: 0.9, confidenceByKey: { revenue: 0.42 } });
    expect(at(all, "net_margin", "FY2024").notes.map((n) => n.code)).toContain("low_confidence");
    expect(at(all, "current_ratio", "FY2024").notes.map((n) => n.code)).not.toContain(
      "low_confidence",
    );
  });

  it("flags a card built on a figure the user edited", () => {
    const all = results("ending", {
      overrides: [{ canonicalKey: "revenue", periodKey: "FY2024", value: 16000 }],
    });
    expect(at(all, "net_margin", "FY2024").notes.map((n) => n.code)).toContain("contains_override");
    close(value(all, "net_margin"), 2100 / 16000);
  });
});

describe("custom ratios", () => {
  const custom = [
    { key: "rd_intensity", label: "R&D intensity", expression: "operating_expenses / revenue", note: null },
  ];

  it("computes under the same rules as the library", () => {
    const all = results("ending", {}, custom);
    const found = pick(all, "rd_intensity");
    expect(found.isCustom).toBe(true);
    close(value(all, "rd_intensity"), 3000 / 15000);
  });

  it("applies averaging and magnitudes to a custom expression", () => {
    const all = results("average", {}, [
      { key: "cash_capex", label: "Cash to capex", expression: "cash_and_equivalents / capital_expenditures", note: null },
      { key: "sales_to_ar", label: "Sales to receivables", expression: "revenue / accounts_receivable", note: null },
    ]);
    // Cash over capex mixes a balance with a cash-flow item, so cash averages to 1350,
    // and capex is read as a magnitude.
    close(value(all, "cash_capex"), 1350 / 1000);
    // Flow over stock: receivables average to 2600.
    close(value(all, "sales_to_ar"), 15000 / 2600);
  });

  it("resolves a custom ratio that references another ratio", () => {
    const all = results("ending", {}, [
      ...custom,
      { key: "double_margin", label: "Double margin", expression: "2 * net_margin", note: null },
      { key: "chained", label: "Chained", expression: "double_margin + rd_intensity", note: null },
    ]);
    close(value(all, "double_margin"), 0.28);
    close(value(all, "chained"), 0.28 + 0.2);
  });

  it("reports a cycle instead of looping forever", () => {
    const all = results("ending", {}, [
      { key: "a_ratio", label: "A", expression: "b_ratio + 1", note: null },
      { key: "b_ratio", label: "B", expression: "a_ratio + 1", note: null },
    ]);
    const a = at(all, "a_ratio", "FY2024");
    expect(a.state).toBe("unavailable");
    expect(a.notes.map((n) => n.code)).toContain("cycle");
  });

  it("marks a reference to a ratio that does not exist as missing", () => {
    const all = results("ending", {}, [
      { key: "orphan", label: "Orphan", expression: "revenue / nonexistent_thing", note: null },
    ]);
    expect(at(all, "orphan", "FY2024").missing).toEqual(["nonexistent_thing"]);
  });
});

describe("DuPont", () => {
  it("reconciles the three components to return on equity", () => {
    const decomposition = dupont(results("ending"), "FY2024");
    close(decomposition.netMargin ?? 0, 0.14);
    close(decomposition.assetTurnover ?? 0, 15000 / 14000);
    close(decomposition.equityMultiplier ?? 0, 2);
    close(decomposition.product ?? 0, 0.3);
    close(decomposition.roe ?? 0, 0.3);
    expect(decomposition.reconciles).toBe(true);
  });

  it("names the component that is missing rather than showing a blank", () => {
    const stripped = computeRatios({
      workspace: fixtureWorkspace(withoutKeys(["total_assets"])),
      mode: "ending",
      custom: [],
    });
    const decomposition = dupont(stripped, "FY2024");
    expect(decomposition.reconciles).toBe(false);
    expect(decomposition.unavailable).toContain("asset_turnover");
  });
});
