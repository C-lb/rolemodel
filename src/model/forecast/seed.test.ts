import { describe, it, expect } from "vitest";
import { DRIVER_KEYS, DRIVER_DEFAULTS } from "./drivers";
import { deriveDrivers, scenarioSeed, type SeededDriver } from "./seed";
import { fixtureSeedInput, withOverrides, withGapBeforeLatest, historicalRows, positiveCostRows } from "./fixtures";
import { closeEnough } from "../tolerance";

/**
 * Rate and day-count tolerances, not money: nothing here goes through `closeEnough`
 * (that carries a currency floor of 1, which would call 0.1 and 0.1000001 equal for
 * the wrong reason). RATE_TOL covers decimal rates computed by a single division.
 * DAY_TOL is looser because a day count also carries a x365 multiplication.
 */
const RATE_TOL = 1e-9;
const DAY_TOL = 1e-6;

function closeRate(actual: number, expected: number, tol = RATE_TOL): void {
  expect(Math.abs(actual - expected), `expected ${actual} to be within ${tol} of ${expected}`).toBeLessThanOrEqual(
    tol,
  );
}

function byKey(drivers: SeededDriver[], key: string): SeededDriver {
  const found = drivers.find((d) => d.key === key);
  if (!found) throw new Error(`no driver seeded for ${key}`);
  return found;
}

// The only two drivers spec 4.1 gives no honest derivation for: interest income is
// embedded inside other_income_expense rather than reported separately, and
// debt_issued_repaid is a net figure a repayment schedule can't be split out of. Every
// other driver, including other_income_expense and dividend_payout, derives.
const ALWAYS_DEFAULT = ["interest_rate_cash", "debt_repayment"];

describe("deriveDrivers — clean fixture", () => {
  const drivers = deriveDrivers(fixtureSeedInput());

  it("returns every driver in DRIVER_KEYS exactly once", () => {
    expect(drivers.map((d) => d.key).sort()).toEqual([...DRIVER_KEYS].sort());
  });

  it("derives every driver except the ones spec 4.1 names as constants", () => {
    for (const d of drivers) {
      if (ALWAYS_DEFAULT.includes(d.key)) {
        expect(d.basis, d.key).toBe("default");
        expect(d.value, d.key).toBe(DRIVER_DEFAULTS[d.key]);
      } else {
        expect(d.basis, d.key).toBe("derived");
      }
      expect(d.note.length, `${d.key} note`).toBeGreaterThan(0);
    }
  });

  it("computes revenue_growth as (1100 - 1000) / 1000 = 0.10", () => {
    closeRate(byKey(drivers, "revenue_growth").value, 0.1);
  });

  it("computes gross_margin as (1100 - 660) / 1100 = 0.4 (cost_of_revenue is -660)", () => {
    closeRate(byKey(drivers, "gross_margin").value, 0.4);
  });

  it("computes rd_pct_revenue as 55 / 1100 = 0.05", () => {
    closeRate(byKey(drivers, "rd_pct_revenue").value, 0.05);
  });

  it("computes sga_pct_revenue as 110 / 1100 = 0.10", () => {
    closeRate(byKey(drivers, "sga_pct_revenue").value, 0.1);
  });

  it("computes sbc_pct_revenue as 22 / 1100 = 0.02", () => {
    closeRate(byKey(drivers, "sbc_pct_revenue").value, 0.02);
  });

  it("computes capex_pct_revenue as 88 / 1100 = 0.08 (capital_expenditures is -88)", () => {
    closeRate(byKey(drivers, "capex_pct_revenue").value, 0.08);
  });

  it("computes dso as 110 / 1100 * 365 = 0.1 * 365 = 36.5", () => {
    closeRate(byKey(drivers, "dso").value, 36.5, DAY_TOL);
  });

  it("computes dio as 66 / 660 * 365 = 0.1 * 365 = 36.5 (cost_of_revenue magnitude is 660)", () => {
    closeRate(byKey(drivers, "dio").value, 36.5, DAY_TOL);
  });

  it("computes dpo as 99 / 660 * 365 = 0.15 * 365 = 54.75 (cost_of_revenue magnitude is 660)", () => {
    closeRate(byKey(drivers, "dpo").value, 54.75, DAY_TOL);
  });

  it("computes depreciation_pct_ppe as 50 / 500 = 0.10", () => {
    closeRate(byKey(drivers, "depreciation_pct_ppe").value, 0.1);
  });

  it("computes tax_rate as 60 / 300 = 0.20 (income_tax_expense is -60)", () => {
    closeRate(byKey(drivers, "tax_rate").value, 0.2);
  });

  it("computes interest_rate_debt as 20 / (50 + 150 + 0) = 20 / 200 = 0.10 (interest_expense is -20, no revolver)", () => {
    closeRate(byKey(drivers, "interest_rate_debt").value, 0.1);
  });

  it("seeds min_cash from the last historical cash balance, 400", () => {
    // min_cash is a currency driver, so it goes through closeEnough — not the
    // rate/day-count tolerance above, which would be too tight for a monetary figure.
    const d = byKey(drivers, "min_cash");
    expect(d.basis).toBe("derived");
    expect(closeEnough(d.value, 400)).toBe(true);
  });

  it("holds other_income_expense flat at the latest historical value, 15", () => {
    const d = byKey(drivers, "other_income_expense");
    expect(d.basis).toBe("derived");
    expect(closeEnough(d.value, 15)).toBe(true);
  });

  it("computes dividend_payout as 42 / 210 = 0.20 (dividends_paid is -42)", () => {
    const d = byKey(drivers, "dividend_payout");
    expect(d.basis).toBe("derived");
    closeRate(d.value, 0.2);
  });

  it("always defaults the two drivers spec 4.1 gives no honest derivation for", () => {
    expect(byKey(drivers, "interest_rate_cash").value).toBe(0.02);
    expect(byKey(drivers, "debt_repayment").value).toBe(0);
  });
});

describe("deriveDrivers — degenerate fixtures", () => {
  it("falls back on revenue_growth, gross_margin and dso when revenue is absent in the latest period", () => {
    const input = fixtureSeedInput(withOverrides([{ period: "FY2024", key: "revenue", value: undefined }]));
    const drivers = deriveDrivers(input);
    for (const key of ["revenue_growth", "gross_margin", "dso"]) {
      const d = byKey(drivers, key);
      expect(d.basis, key).toBe("default");
      expect(d.value, key).toBe(DRIVER_DEFAULTS[key]);
      expect(d.note.length, `${key} note`).toBeGreaterThan(0);
    }
  });

  it("falls back on gross_margin, rd_pct_revenue and dso when revenue is zero in the latest period", () => {
    const input = fixtureSeedInput(withOverrides([{ period: "FY2024", key: "revenue", value: 0 }]));
    const drivers = deriveDrivers(input);
    for (const key of ["gross_margin", "rd_pct_revenue", "dso"]) {
      const d = byKey(drivers, key);
      expect(d.basis, key).toBe("default");
      expect(d.value, key).toBe(DRIVER_DEFAULTS[key]);
      expect(d.note.length, `${key} note`).toBeGreaterThan(0);
    }
  });

  it("falls back on dio and dpo, but not gross_margin, when cost_of_revenue is zero", () => {
    const input = fixtureSeedInput(withOverrides([{ period: "FY2024", key: "cost_of_revenue", value: 0 }]));
    const drivers = deriveDrivers(input);
    for (const key of ["dio", "dpo"]) {
      const d = byKey(drivers, key);
      expect(d.basis, key).toBe("default");
      expect(d.value, key).toBe(DRIVER_DEFAULTS[key]);
      expect(d.note.length, `${key} note`).toBeGreaterThan(0);
    }
    // (1100 - 0) / 1100 = 1.0: a valid, if extreme, margin — not a fallback case.
    const margin = byKey(drivers, "gross_margin");
    expect(margin.basis).toBe("derived");
    closeRate(margin.value, 1.0);
  });

  it("falls back on tax_rate when pretax_income is negative", () => {
    const input = fixtureSeedInput(
      withOverrides([
        { period: "FY2024", key: "pretax_income", value: -50 },
        { period: "FY2024", key: "income_tax_expense", value: -10 },
      ]),
    );
    const drivers = deriveDrivers(input);
    const d = byKey(drivers, "tax_rate");
    expect(d.basis).toBe("default");
    expect(d.value).toBe(DRIVER_DEFAULTS.tax_rate);
    expect(d.note.length).toBeGreaterThan(0);
  });

  it("falls back on tax_rate when the computed rate is above the 0.5 clamp", () => {
    // 700 / 300 = 2.33..., well past the 0.5 ceiling.
    const input = fixtureSeedInput(withOverrides([{ period: "FY2024", key: "income_tax_expense", value: -700 }]));
    const drivers = deriveDrivers(input);
    const d = byKey(drivers, "tax_rate");
    expect(d.basis).toBe("default");
    expect(d.value).toBe(DRIVER_DEFAULTS.tax_rate);
    expect(d.note.length).toBeGreaterThan(0);
  });

  it("falls back on interest_rate_debt when there is no debt", () => {
    const input = fixtureSeedInput(
      withOverrides([
        { period: "FY2024", key: "short_term_debt", value: 0 },
        { period: "FY2024", key: "long_term_debt", value: 0 },
      ]),
    );
    const drivers = deriveDrivers(input);
    const d = byKey(drivers, "interest_rate_debt");
    expect(d.basis).toBe("default");
    expect(d.value).toBe(DRIVER_DEFAULTS.interest_rate_debt);
    expect(d.note.length).toBeGreaterThan(0);
  });

  it("falls back on revenue_growth when the two most recent periods are not adjacent", () => {
    const input = fixtureSeedInput(withGapBeforeLatest());
    const drivers = deriveDrivers(input);
    const d = byKey(drivers, "revenue_growth");
    expect(d.basis).toBe("default");
    expect(d.value).toBe(DRIVER_DEFAULTS.revenue_growth);
    expect(d.note.length).toBeGreaterThan(0);
  });

  it("falls back on dividend_payout when net_income is not positive", () => {
    const input = fixtureSeedInput(withOverrides([{ period: "FY2024", key: "net_income", value: -10 }]));
    const drivers = deriveDrivers(input);
    const d = byKey(drivers, "dividend_payout");
    expect(d.basis).toBe("default");
    expect(d.value).toBe(DRIVER_DEFAULTS.dividend_payout);
    expect(d.note.length).toBeGreaterThan(0);
  });

  it("falls back on dividend_payout when no dividends were paid", () => {
    const input = fixtureSeedInput(withOverrides([{ period: "FY2024", key: "dividends_paid", value: 0 }]));
    const drivers = deriveDrivers(input);
    const d = byKey(drivers, "dividend_payout");
    expect(d.basis).toBe("default");
    expect(d.value).toBe(DRIVER_DEFAULTS.dividend_payout);
    expect(d.note.length).toBeGreaterThan(0);
  });

  it("derives dio and dpo identically when cost_of_revenue is stored positive instead of negative", () => {
    // cost_of_revenue is a structurally one-signed cost line: seeding reads its
    // magnitude, so +660 and -660 must produce the same day counts, not a fallback.
    const input = fixtureSeedInput(withOverrides([{ period: "FY2024", key: "cost_of_revenue", value: 660 }]));
    const drivers = deriveDrivers(input);
    const dio = byKey(drivers, "dio");
    const dpo = byKey(drivers, "dpo");
    expect(dio.basis).toBe("derived");
    expect(dpo.basis).toBe("derived");
    closeRate(dio.value, 36.5, DAY_TOL);
    closeRate(dpo.value, 54.75, DAY_TOL);
  });

  it("falls back on dio and dpo when cost_of_revenue is exactly zero", () => {
    const input = fixtureSeedInput(withOverrides([{ period: "FY2024", key: "cost_of_revenue", value: 0 }]));
    const drivers = deriveDrivers(input);
    for (const key of ["dio", "dpo"]) {
      const d = byKey(drivers, key);
      expect(d.basis, key).toBe("default");
      expect(d.value, key).toBe(DRIVER_DEFAULTS[key]);
      expect(d.note.length, `${key} note`).toBeGreaterThan(0);
    }
  });
});

describe("deriveDrivers — positive-cost fixture", () => {
  // The same filing under the opposite sign convention: cost_of_revenue, interest_expense,
  // income_tax_expense, research_development, selling_general_admin, capital_expenditures
  // and dividends_paid all printed positive instead of negative (`positiveCostRows`, also
  // used by the engine's Task 4 fixtures). This is the property the bug missed: every
  // derivation must produce the SAME driver value regardless of which convention the
  // source document used, because seeding reads magnitudes, never an assumed sign.
  const negative = deriveDrivers(fixtureSeedInput({ rows: historicalRows() }));
  const positive = deriveDrivers(fixtureSeedInput({ rows: positiveCostRows() }));

  it("returns every driver in DRIVER_KEYS exactly once", () => {
    expect(positive.map((d) => d.key).sort()).toEqual([...DRIVER_KEYS].sort());
  });

  it("produces the same value as the negative-cost fixture for every driver", () => {
    for (const neg of negative) {
      const pos = byKey(positive, neg.key);
      expect(pos.basis, neg.key).toBe(neg.basis);
      if (typeof pos.value === "number" && typeof neg.value === "number") {
        closeRate(pos.value, neg.value, 1e-6);
      }
    }
  });

  it("computes gross_margin as 0.4 from a positive-stored cost_of_revenue (the 160% regression case)", () => {
    closeRate(byKey(positive, "gross_margin").value, 0.4);
  });
});

describe("scenarioSeed", () => {
  const base = deriveDrivers(fixtureSeedInput());

  it("base is an unchanged copy, not the same array reference", () => {
    const seeded = scenarioSeed(base, "base");
    expect(seeded).not.toBe(base);
    expect(seeded).toEqual(base);
  });

  it("bull moves exactly revenue_growth (+300bps) and gross_margin (+100bps) and nothing else", () => {
    const seeded = scenarioSeed(base, "bull");
    for (const d of seeded) {
      const original = byKey(base, d.key);
      if (d.key === "revenue_growth") {
        closeRate(d.value, original.value + 0.03);
      } else if (d.key === "gross_margin") {
        closeRate(d.value, original.value + 0.01);
      } else {
        expect(d.value, d.key).toBe(original.value);
      }
    }
  });

  it("bear moves revenue_growth down 300bps and gross_margin down 100bps, nothing else", () => {
    const seeded = scenarioSeed(base, "bear");
    for (const d of seeded) {
      const original = byKey(base, d.key);
      if (d.key === "revenue_growth") {
        closeRate(d.value, original.value - 0.03);
      } else if (d.key === "gross_margin") {
        closeRate(d.value, original.value - 0.01);
      } else {
        expect(d.value, d.key).toBe(original.value);
      }
    }
  });

  it("bear floors gross_margin at zero rather than going negative", () => {
    const lowMargin: SeededDriver[] = base.map((d) =>
      d.key === "gross_margin" ? { ...d, value: 0.004 } : d,
    );
    const seeded = scenarioSeed(lowMargin, "bear");
    expect(byKey(seeded, "gross_margin").value).toBe(0);
  });
});
