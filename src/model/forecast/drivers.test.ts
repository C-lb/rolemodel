import { describe, it, expect } from "vitest";
import { DRIVERS, DRIVER_KEYS, DRIVER_DEFAULTS, driver } from "./drivers";

const EXPECTED_UNITS: Record<string, "percent" | "days" | "currency"> = {
  revenue_growth: "percent",
  gross_margin: "percent",
  rd_pct_revenue: "percent",
  sga_pct_revenue: "percent",
  sbc_pct_revenue: "percent",
  other_income_expense: "currency",
  dso: "days",
  dio: "days",
  dpo: "days",
  capex_pct_revenue: "percent",
  depreciation_pct_ppe: "percent",
  tax_rate: "percent",
  dividend_payout: "percent",
  interest_rate_debt: "percent",
  interest_rate_cash: "percent",
  debt_repayment: "currency",
  min_cash: "currency",
};

const EXPECTED_DEFAULTS: Record<string, number> = {
  revenue_growth: 0.03,
  gross_margin: 0,
  rd_pct_revenue: 0,
  sga_pct_revenue: 0,
  sbc_pct_revenue: 0,
  other_income_expense: 0,
  dso: 0,
  dio: 0,
  dpo: 0,
  capex_pct_revenue: 0,
  depreciation_pct_ppe: 0,
  tax_rate: 0.21,
  dividend_payout: 0,
  interest_rate_debt: 0,
  interest_rate_cash: 0.02,
  debt_repayment: 0,
  min_cash: 0,
};

describe("driver catalogue", () => {
  it("ships seventeen drivers", () => {
    expect(DRIVERS).toHaveLength(17);
    expect(DRIVER_KEYS).toHaveLength(17);
  });

  it("has unique keys, and DRIVER_KEYS matches DRIVERS", () => {
    const keys = DRIVERS.map((d) => d.key);
    expect(new Set(keys).size).toBe(DRIVERS.length);
    expect([...DRIVER_KEYS].sort()).toEqual([...keys].sort());
  });

  it("matches the spec's unit for every driver", () => {
    for (const d of DRIVERS) {
      expect(d.unit, d.key).toBe(EXPECTED_UNITS[d.key]);
    }
    expect(Object.keys(EXPECTED_UNITS).sort()).toEqual([...DRIVER_KEYS].sort());
  });

  it("gives every driver a non-empty label, definition and tooltip", () => {
    for (const d of DRIVERS) {
      expect(d.label.length, `${d.key} label`).toBeGreaterThan(2);
      expect(d.definition.length, `${d.key} definition`).toBeGreaterThan(40);
      expect(d.tooltip.length, `${d.key} tooltip`).toBeGreaterThan(10);
    }
  });

  it("looks a driver up by key", () => {
    expect(driver("revenue_growth")?.unit).toBe("percent");
    expect(driver("not_a_driver")).toBeUndefined();
  });

  it("defaults every one of the seventeen keys per spec 4.1", () => {
    expect(Object.keys(DRIVER_DEFAULTS).sort()).toEqual([...DRIVER_KEYS].sort());
    for (const key of DRIVER_KEYS) {
      expect(DRIVER_DEFAULTS[key], key).toBe(EXPECTED_DEFAULTS[key]);
    }
  });
});
