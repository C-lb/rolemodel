import type { SeedInput } from "./seed";

/**
 * A three-year historical model for the forecast-seeding tests, chosen so every
 * driver in `DRIVERS` has an answer that can be worked out on paper. The expectations
 * in `seed.test.ts` are literals from that arithmetic, never computed with the code
 * under test.
 *
 * `cost_of_revenue`, `interest_expense`, `income_tax_expense`, `capital_expenditures` and
 * `dividends_paid` are stored negative on purpose, matching what a filing prints — the
 * sign-normalisation cases a fixture that stored them positive would never exercise.
 * `revolver` is omitted entirely: it is `absentMeansZero` in the taxonomy, and no
 * historical document ever reports one. `debt_issued_repaid` is included for Task 4's
 * engine tests; nothing in this task derives a driver from it.
 */
export type Row = Record<string, number>;

export const FY2022: Row = {
  revenue: 900,
  cost_of_revenue: -540,
  research_development: 45,
  selling_general_admin: 90,
  stock_based_compensation: 18,
  interest_expense: -16,
  pretax_income: 250,
  income_tax_expense: -50,
  cash_and_equivalents: 330,
  accounts_receivable: 90,
  inventory: 54,
  property_plant_equipment: 410,
  accounts_payable: 81,
  short_term_debt: 40,
  long_term_debt: 120,
  depreciation_amortisation: 41,
  capital_expenditures: -72,
  other_income_expense: 10,
  net_income: 150,
  dividends_paid: -30,
  debt_issued_repaid: -15,
};

export const FY2023: Row = {
  revenue: 1000,
  cost_of_revenue: -600,
  research_development: 50,
  selling_general_admin: 100,
  stock_based_compensation: 20,
  interest_expense: -18,
  pretax_income: 270,
  income_tax_expense: -54,
  cash_and_equivalents: 360,
  accounts_receivable: 100,
  inventory: 60,
  property_plant_equipment: 460,
  accounts_payable: 90,
  short_term_debt: 45,
  long_term_debt: 135,
  depreciation_amortisation: 45,
  capital_expenditures: -80,
  other_income_expense: 12,
  net_income: 180,
  dividends_paid: -36,
  debt_issued_repaid: -20,
};

/**
 * The period every clean-fixture driver derives from. Revenue growth is the only
 * driver that reaches back to `FY2023`; every other driver reads this period alone.
 */
export const FY2024: Row = {
  revenue: 1100,
  cost_of_revenue: -660,
  research_development: 55,
  selling_general_admin: 110,
  stock_based_compensation: 22,
  interest_expense: -20,
  pretax_income: 300,
  income_tax_expense: -60,
  cash_and_equivalents: 400,
  accounts_receivable: 110,
  inventory: 66,
  property_plant_equipment: 500,
  accounts_payable: 99,
  short_term_debt: 50,
  long_term_debt: 150,
  depreciation_amortisation: 50,
  capital_expenditures: -88,
  other_income_expense: 15,
  net_income: 210,
  dividends_paid: -42,
  debt_issued_repaid: -25,

  // ---- Balance sheet completion, added for the engine (Task 4) ----------------
  // The seeding tests never needed a closing balance sheet; the engine does, because
  // it opens every forecast period from one and then checks that the forecast closes.
  // These figures are chosen so FY2024 balances exactly:
  //   current assets     400 + 20 + 110 + 66 + 24                    = 620
  //   total assets       620 + 500 (PP&E) + 50 + 30 + 26             = 1226
  //   current liabs      99 + 60 + 40 + 50 + 21                      = 270
  //   total liabilities  270 + 150 (LTD) + 80                        = 500
  //   total equity       400 + 376 - 80 + 30                         = 726
  //   500 + 726 = 1226 = total assets.
  // `revolver` stays absent: `absentMeansZero` in the taxonomy, and no filing reports one.
  short_term_investments: 20,
  other_current_assets: 24,
  goodwill: 50,
  intangible_assets: 30,
  other_noncurrent_assets: 26,
  accrued_liabilities: 60,
  deferred_revenue_current: 40,
  other_current_liabilities: 21,
  other_noncurrent_liabilities: 80,
  common_stock_apic: 400,
  retained_earnings: 376,
  treasury_stock: -80,
  accumulated_oci: 30,
};

export interface FixtureOptions {
  /** Period key to row. Defaults to the three years above, most recent first. */
  rows?: Record<string, Row>;
}

/** The default three-period row set, most recent first. */
export function historicalRows(): Record<string, Row> {
  return { FY2024: { ...FY2024 }, FY2023: { ...FY2023 }, FY2022: { ...FY2022 } };
}

/** A `SeedInput` over the given (or default) rows. */
export function fixtureSeedInput(options: FixtureOptions = {}): SeedInput {
  const rows = options.rows ?? historicalRows();
  return {
    periods: Object.keys(rows),
    valueAt(key: string, period: string): number | undefined {
      return rows[period]?.[key];
    },
  };
}

export interface RowOverride {
  period: string;
  key: string;
  /** `undefined` deletes the key from that period's row, simulating an absent fact. */
  value: number | undefined;
}

/**
 * The default rows with a set of single-cell overrides applied — deleting a key when
 * `value` is `undefined`, or replacing it otherwise. Used to build the degenerate
 * fixtures: a zero or missing input that should force a driver to fall back.
 */
export function withOverrides(overrides: RowOverride[], options: FixtureOptions = {}): FixtureOptions {
  const base = options.rows ?? historicalRows();
  const rows: Record<string, Row> = {};
  for (const [period, row] of Object.entries(base)) rows[period] = { ...row };
  for (const { period, key, value } of overrides) {
    const row = rows[period];
    if (!row) continue;
    if (value === undefined) delete row[key];
    else row[key] = value;
  }
  return { rows };
}

/** The default rows with `FY2023` removed, so the two most recent periods are not adjacent. */
export function withGapBeforeLatest(): FixtureOptions {
  const base = historicalRows();
  const rows: Record<string, Row> = { FY2024: base.FY2024, FY2022: base.FY2022 };
  return { rows };
}

// ===========================================================================
// Engine fixture (Task 4)
// ===========================================================================

/**
 * The driver set the engine fixture runs on, held identical in both forecast periods.
 *
 * These are literals chosen for hand arithmetic, not the output of `deriveDrivers`.
 * A fixture seeded by the code under test could not disagree with it. The working-capital
 * days deliberately reproduce the FY2024 ratios exactly (110/1100 = 0.1, 66/660 = 0.1,
 * 99/660 = 0.15) so the working-capital movement is driven by growth alone and can be
 * checked in one line; growth is set high enough that dropping the movement moves the
 * balance sheet by more than `closeEnough` tolerates.
 *
 *   dso 36.5  ->  36.5 / 365  = 0.10 of revenue
 *   dio 36.5  ->  36.5 / 365  = 0.10 of |cost of revenue|
 *   dpo 54.75 ->  54.75 / 365 = 0.15 of |cost of revenue|
 */
export const ENGINE_DRIVERS: Readonly<Record<string, number>> = {
  revenue_growth: 0.3,
  gross_margin: 0.4,
  rd_pct_revenue: 0.05,
  sga_pct_revenue: 0.1,
  sbc_pct_revenue: 0.02,
  other_income_expense: 15,
  dso: 36.5,
  dio: 36.5,
  dpo: 54.75,
  capex_pct_revenue: 0.08,
  depreciation_pct_ppe: 0.1,
  tax_rate: 0.2,
  dividend_payout: 0.2,
  interest_rate_debt: 0.1,
  interest_rate_cash: 0.05,
  debt_repayment: 20,
  min_cash: 400,
};

/**
 * FY2025, the first forecast period. Every `[P]` below is FY2024, a historical period.
 * Worked by hand from spec section 5; nothing here is produced by `runForecast`.
 */
export const EXPECTED_FY2025: Row = {
  // ---- Income statement (5.1) ----
  revenue: 1430,                    // 1100 * (1 + 0.30)
  cost_of_revenue: -858,            // -(1430 * (1 - 0.40))
  gross_profit: 572,                // 1430 + (-858)
  research_development: -71.5,      // -(1430 * 0.05)
  selling_general_admin: -143,      // -(1430 * 0.10)
  operating_expenses: -214.5,       // -71.5 + (-143)
  operating_income: 357.5,          // 572 + (-214.5)
  interest_expense: -20,            // -((50 + 150 + 0) * 0.10); revolver[P] absent = 0
  other_income_expense: 35,         // 15 + 400 * 0.05
  pretax_income: 372.5,             // 357.5 + (-20) + 35
  income_tax_expense: -74.5,        // -(max(372.5, 0) * 0.20)
  net_income: 298,                  // 372.5 + (-74.5)

  // ---- Cash flow (5.2, 5.3) ----
  cf_net_income: 298,               // the same net income, on its cash-flow line
  depreciation_amortisation: 50,    // 500 * 0.10, on OPENING PP&E (closing would be 61.44)
  stock_based_compensation: 28.6,   // 1430 * 0.02
  change_in_working_capital: -23.1, // -((143-110) + (85.8-66) - (128.7-99)) = -(33 + 19.8 - 29.7)
  cash_from_operations: 353.5,      // 298 + 50 + 28.6 + (-23.1)
  capital_expenditures: -114.4,     // -(1430 * 0.08)
  acquisitions: 0,
  other_investing: 0,
  cash_from_investing: -114.4,      // -114.4 + 0 + 0
  debt_issued_repaid: -20,          // -20 (the debt_repayment driver)
  equity_issued_repurchased: 0,
  dividends_paid: -59.6,            // -(max(298, 0) * 0.20)
  other_financing: 0,
  cash_from_financing: -79.6,       // (-20 + -59.6) + revolver movement 0
  fx_effect_on_cash: 0,
  net_change_in_cash: 159.5,        // 353.5 + (-114.4) + (-79.6)

  // ---- Balance sheet (5.4) ----
  // Plug: cashBeforePlug = 400 + 159.5 = 559.5 >= min_cash 400, revolver[P] = 0,
  // so nothing is repaid and cash settles at 559.5.
  cash_and_equivalents: 559.5,
  short_term_investments: 20,       // held flat
  accounts_receivable: 143,         // 36.5/365 * 1430
  inventory: 85.8,                  // 36.5/365 * 858
  other_current_assets: 24,         // held flat
  total_current_assets: 832.3,      // 559.5 + 20 + 143 + 85.8 + 24
  property_plant_equipment: 564.4,  // 500 + 114.4 - 50
  goodwill: 50,                     // held flat
  intangible_assets: 30,            // held flat
  other_noncurrent_assets: 26,      // held flat
  total_assets: 1502.7,             // 832.3 + 564.4 + 50 + 30 + 26
  accounts_payable: 128.7,          // 54.75/365 * 858
  accrued_liabilities: 60,          // held flat
  deferred_revenue_current: 40,     // held flat
  short_term_debt: 50,              // held flat
  revolver: 0,                      // from the plug
  other_current_liabilities: 21,    // held flat
  total_current_liabilities: 299.7, // 128.7 + 60 + 40 + 50 + 0 + 21
  long_term_debt: 130,              // max(150 - 20, 0)
  other_noncurrent_liabilities: 80, // held flat
  total_liabilities: 509.7,         // 299.7 + 130 + 80
  common_stock_apic: 428.6,         // 400 + 28.6
  retained_earnings: 614.4,         // 376 + 298 + (-59.6)
  treasury_stock: -80,              // held flat
  accumulated_oci: 30,              // held flat
  total_equity: 993,                // 428.6 + 614.4 + (-80) + 30
  // 509.7 + 993 = 1502.7 = total assets.
};

/**
 * FY2026, the second forecast period. Every `[P]` here is FY2025 — a FORECAST period,
 * which is the only reason two periods are worked by hand rather than one.
 */
export const EXPECTED_FY2026: Row = {
  // ---- Income statement (5.1) ----
  revenue: 1859,                    // 1430 * 1.30
  cost_of_revenue: -1115.4,         // -(1859 * 0.60)
  gross_profit: 743.6,              // 1859 + (-1115.4)
  research_development: -92.95,     // -(1859 * 0.05)
  selling_general_admin: -185.9,    // -(1859 * 0.10)
  operating_expenses: -278.85,      // -92.95 + (-185.9)
  operating_income: 464.75,         // 743.6 + (-278.85)
  interest_expense: -18,            // -((50 + 130 + 0) * 0.10), opening debt from FY2025
  other_income_expense: 42.975,     // 15 + 559.5 * 0.05, opening cash from FY2025
  pretax_income: 489.725,           // 464.75 + (-18) + 42.975
  income_tax_expense: -97.945,      // -(489.725 * 0.20)
  net_income: 391.78,               // 489.725 + (-97.945)

  // ---- Cash flow (5.2, 5.3) ----
  cf_net_income: 391.78,
  depreciation_amortisation: 56.44, // 564.4 * 0.10, opening PP&E from FY2025
  stock_based_compensation: 37.18,  // 1859 * 0.02
  change_in_working_capital: -30.03,// -((185.9-143) + (111.54-85.8) - (167.31-128.7))
  cash_from_operations: 455.37,     // 391.78 + 56.44 + 37.18 + (-30.03)
  capital_expenditures: -148.72,    // -(1859 * 0.08)
  acquisitions: 0,
  other_investing: 0,
  cash_from_investing: -148.72,
  debt_issued_repaid: -20,
  equity_issued_repurchased: 0,
  dividends_paid: -78.356,          // -(391.78 * 0.20)
  other_financing: 0,
  cash_from_financing: -98.356,     // (-20 + -78.356) + revolver movement 0
  fx_effect_on_cash: 0,
  net_change_in_cash: 208.294,      // 455.37 + (-148.72) + (-98.356)

  // ---- Balance sheet (5.4) ----
  // Plug: 559.5 + 208.294 = 767.794 >= 400, revolver[P] = 0, nothing repaid.
  cash_and_equivalents: 767.794,
  short_term_investments: 20,
  accounts_receivable: 185.9,       // 0.10 * 1859
  inventory: 111.54,                // 0.10 * 1115.4
  other_current_assets: 24,
  total_current_assets: 1109.234,   // 767.794 + 20 + 185.9 + 111.54 + 24
  property_plant_equipment: 656.68, // 564.4 + 148.72 - 56.44
  goodwill: 50,
  intangible_assets: 30,
  other_noncurrent_assets: 26,
  total_assets: 1871.914,           // 1109.234 + 656.68 + 50 + 30 + 26
  accounts_payable: 167.31,         // 0.15 * 1115.4
  accrued_liabilities: 60,
  deferred_revenue_current: 40,
  short_term_debt: 50,
  revolver: 0,
  other_current_liabilities: 21,
  total_current_liabilities: 338.31,// 167.31 + 60 + 40 + 50 + 0 + 21
  long_term_debt: 110,              // max(130 - 20, 0)
  other_noncurrent_liabilities: 80,
  total_liabilities: 528.31,        // 338.31 + 110 + 80
  common_stock_apic: 465.78,        // 428.6 + 37.18
  retained_earnings: 927.824,       // 614.4 + 391.78 + (-78.356)
  treasury_stock: -80,
  accumulated_oci: 30,
  total_equity: 1343.604,           // 465.78 + 927.824 + (-80) + 30
  // 528.31 + 1343.604 = 1871.914 = total assets.
};

/** The two hand-worked forecast periods, keyed by period. */
export const EXPECTED_FORECAST: Record<string, Row> = {
  FY2025: EXPECTED_FY2025,
  FY2026: EXPECTED_FY2026,
};

export interface EngineFixtureOptions extends FixtureOptions {
  /** Forecast periods to run. Defaults to the two hand-worked years. */
  forecastPeriods?: string[];
  /** Driver overrides, applied to every forecast period. */
  drivers?: Record<string, number>;
  /** Per-period driver overrides, applied on top of `drivers`. */
  driversByPeriod?: Record<string, Record<string, number>>;
  /** Driver keys to report as a fallback constant rather than derived. */
  defaultedDrivers?: string[];
  /** When true, the input supplies no `driverBasisAt` at all. */
  omitDriverBasis?: boolean;
}

/**
 * A `ForecastInput` shape over the fixture history. Typed structurally rather than by
 * importing `ForecastInput` so the fixtures module stays independent of the engine it
 * feeds; the test asserts the two agree by passing this straight into `runForecast`.
 */
export interface FixtureForecastInput {
  historicalPeriods: string[];
  forecastPeriods: string[];
  valueAt(key: string, period: string): number | undefined;
  driverAt(key: string, period: string): number | undefined;
  driverBasisAt?(key: string, period: string): "derived" | "default" | undefined;
}

export function fixtureForecastInput(options: EngineFixtureOptions = {}): FixtureForecastInput {
  const rows = options.rows ?? historicalRows();
  const forecastPeriods = options.forecastPeriods ?? ["FY2025", "FY2026"];
  const drivers = { ...ENGINE_DRIVERS, ...(options.drivers ?? {}) };
  const byPeriod = options.driversByPeriod ?? {};
  const defaulted = new Set(options.defaultedDrivers ?? []);

  const input: FixtureForecastInput = {
    historicalPeriods: Object.keys(rows),
    forecastPeriods,
    valueAt(key, period) {
      return rows[period]?.[key];
    },
    driverAt(key, period) {
      const override = byPeriod[period]?.[key];
      return override ?? drivers[key];
    },
  };
  if (!options.omitDriverBasis) {
    input.driverBasisAt = (key) => (defaulted.has(key) ? "default" : "derived");
  }
  return input;
}

// ---- The plug fixture -----------------------------------------------------------
//
// A deliberately bare opening balance sheet — cash 1000 against equity 1000, nothing
// else — so the four plug cases in spec section 11 can be driven purely by the
// `other_income_expense` driver, one case per period, with no working capital, capex,
// tax, interest or dividends moving cash underneath them.

/** Opening balance sheet for the plug run: assets 1000 = liabilities 0 + equity 1000. */
export const PLUG_BASE: Row = {
  revenue: 1000,
  cash_and_equivalents: 1000,
  accounts_receivable: 0,
  inventory: 0,
  accounts_payable: 0,
  property_plant_equipment: 0,
  short_term_debt: 0,
  long_term_debt: 0,
  common_stock_apic: 1000,
  retained_earnings: 0,
};

/** Every rate off, so net income is exactly `1000 + other_income_expense`. */
export const PLUG_DRIVERS: Readonly<Record<string, number>> = {
  revenue_growth: 0,
  gross_margin: 1,
  rd_pct_revenue: 0,
  sga_pct_revenue: 0,
  sbc_pct_revenue: 0,
  other_income_expense: 0,
  dso: 0,
  dio: 0,
  dpo: 0,
  capex_pct_revenue: 0,
  depreciation_pct_ppe: 0,
  tax_rate: 0,
  dividend_payout: 0,
  interest_rate_debt: 0,
  interest_rate_cash: 0,
  debt_repayment: 0,
  min_cash: 1000,
};

/**
 * One period per plug case, in the order spec section 11 lists them, driven by
 * `other_income_expense` alone:
 *
 *   FY2025  other -1150 -> NI -150 -> before plug 1000-150 =  850 < 1000, DRAWS 150
 *   FY2026  other  -950 -> NI   50 -> before plug 1000+ 50 = 1050, surplus 50 < revolver 150,
 *                                     REPAYS 50 PARTIALLY and cash stays on the 1000 floor
 *   FY2027  other  -800 -> NI  200 -> before plug 1000+200 = 1200, surplus 200 > revolver 100,
 *                                     REPAYS 100 IN FULL and cash settles at 1100
 *   FY2028  other  -900 -> NI  100 -> before plug 1100+100 = 1200, revolver already 0, SURPLUS
 */
export const PLUG_PERIODS = ["FY2025", "FY2026", "FY2027", "FY2028"];

export const PLUG_OTHER_INCOME: Record<string, number> = {
  FY2025: -1150,
  FY2026: -950,
  FY2027: -800,
  FY2028: -900,
};

/** The `PlugDetail` each period must report, worked by hand from spec section 5.3. */
export const EXPECTED_PLUGS = [
  { periodKey: "FY2025", cashBeforePlug: 850, drawn: 150, repaid: 0, revolverBalance: 150 },
  { periodKey: "FY2026", cashBeforePlug: 1050, drawn: 0, repaid: 50, revolverBalance: 100 },
  { periodKey: "FY2027", cashBeforePlug: 1200, drawn: 0, repaid: 100, revolverBalance: 0 },
  { periodKey: "FY2028", cashBeforePlug: 1200, drawn: 0, repaid: 0, revolverBalance: 0 },
];

/** Plugged cash and the financing line that must carry the revolver movement. */
export const EXPECTED_PLUG_CASH: Record<string, { cash: number; cashFromFinancing: number; netChangeInCash: number }> = {
  FY2025: { cash: 1000, cashFromFinancing: 150, netChangeInCash: 0 },
  FY2026: { cash: 1000, cashFromFinancing: -50, netChangeInCash: 0 },
  FY2027: { cash: 1100, cashFromFinancing: -100, netChangeInCash: 100 },
  FY2028: { cash: 1200, cashFromFinancing: 0, netChangeInCash: 100 },
};

export function plugForecastInput(overrides: { base?: Row; drivers?: Record<string, number> } = {}): FixtureForecastInput {
  const base = { ...PLUG_BASE, ...(overrides.base ?? {}) };
  const drivers = { ...PLUG_DRIVERS, ...(overrides.drivers ?? {}) };
  return {
    historicalPeriods: ["FY2024"],
    forecastPeriods: [...PLUG_PERIODS],
    valueAt(key, period) {
      return period === "FY2024" ? base[key] : undefined;
    },
    driverAt(key, period) {
      if (key === "other_income_expense") return PLUG_OTHER_INCOME[period] ?? 0;
      return drivers[key];
    },
    driverBasisAt: () => "derived",
  };
}
