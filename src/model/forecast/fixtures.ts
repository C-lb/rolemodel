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
 * checked in one line.
 *
 *   dso 36.5  ->  36.5 / 365  = 0.10 of revenue
 *   dio 36.5  ->  36.5 / 365  = 0.10 of |cost of revenue|
 *   dpo 54.75 ->  54.75 / 365 = 0.15 of |cost of revenue|
 */
export const ENGINE_DRIVERS: Readonly<Record<string, number>> = {
  revenue_growth: 0.1,
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
  // NOTE ON SIGNS. This fixture's history is mixed on purpose, because real filings are:
  // cost of revenue, interest, tax, capex and dividends print negative, while R&D and
  // SG&A print positive. The engine computes every one of them negative internally
  // (spec 5.1) and emits each in the convention its OWN history used, so the forecast
  // column never flips sign against the history column beside it. That is why R&D and
  // SG&A are positive below while cost of revenue is negative.
  revenue: 1210,                    // 1100 * (1 + 0.10)
  cost_of_revenue: -726,            // -(1210 * (1 - 0.40))
  gross_profit: 484,                // 1210 + (-726)
  research_development: 60.5,       // 1210 * 0.05, printed positive: see the note below
  selling_general_admin: 121,       // 1210 * 0.10, printed positive
  operating_expenses: 181.5,        // 60.5 + 121, the sum of the components as printed
  operating_income: 302.5,          // 484 - 181.5, computed in the engine's own convention
  interest_expense: -20,            // -((50 + 150 + 0) * 0.10); revolver[P] absent = 0
  other_income_expense: 35,         // 15 + 400 * 0.05
  pretax_income: 317.5,             // 302.5 + (-20) + 35
  income_tax_expense: -63.5,        // -(max(317.5, 0) * 0.20)
  net_income: 254,                  // 317.5 + (-63.5)

  // ---- Cash flow (5.2, 5.3) ----
  cf_net_income: 254,               // the same net income, on its cash-flow line
  depreciation_amortisation: 50,    // 500 * 0.10, on OPENING PP&E (closing would be 54.68)
  stock_based_compensation: 24.2,   // 1210 * 0.02
  change_in_working_capital: -7.7,  // -((121-110) + (72.6-66) - (108.9-99)) = -(11 + 6.6 - 9.9)
  cash_from_operations: 320.5,      // 254 + 50 + 24.2 + (-7.7)
  capital_expenditures: -96.8,      // -(1210 * 0.08)
  acquisitions: 0,
  other_investing: 0,
  cash_from_investing: -96.8,       // -96.8 + 0 + 0
  debt_issued_repaid: -20,          // -20 (the debt_repayment driver)
  revolver_movement: 0,             // nothing drawn, nothing outstanding to repay
  equity_issued_repurchased: 0,
  dividends_paid: -50.8,            // -(max(254, 0) * 0.20)
  other_financing: 0,
  cash_from_financing: -70.8,       // -20 + 0 + 0 + (-50.8) + 0
  fx_effect_on_cash: 0,
  net_change_in_cash: 152.9,        // 320.5 + (-96.8) + (-70.8)

  // ---- Balance sheet (5.4) ----
  // Plug: cashBeforePlug = 400 + 152.9 = 552.9 >= min_cash 400, revolver[P] = 0,
  // so nothing is repaid and cash settles at 552.9.
  cash_and_equivalents: 552.9,
  short_term_investments: 20,       // held flat
  accounts_receivable: 121,         // 36.5/365 * 1210
  inventory: 72.6,                  // 36.5/365 * 726
  other_current_assets: 24,         // held flat
  total_current_assets: 790.5,      // 552.9 + 20 + 121 + 72.6 + 24
  property_plant_equipment: 546.8,  // 500 + 96.8 - 50
  goodwill: 50,                     // held flat
  intangible_assets: 30,            // held flat
  other_noncurrent_assets: 26,      // held flat
  total_assets: 1443.3,             // 790.5 + 546.8 + 50 + 30 + 26
  accounts_payable: 108.9,          // 54.75/365 * 726
  accrued_liabilities: 60,          // held flat
  deferred_revenue_current: 40,     // held flat
  short_term_debt: 50,              // held flat
  revolver: 0,                      // from the plug
  other_current_liabilities: 21,    // held flat
  total_current_liabilities: 279.9, // 108.9 + 60 + 40 + 50 + 0 + 21
  long_term_debt: 130,              // max(150 - 20, 0)
  other_noncurrent_liabilities: 80, // held flat
  total_liabilities: 489.9,         // 279.9 + 130 + 80
  common_stock_apic: 424.2,         // 400 + 24.2
  retained_earnings: 579.2,         // 376 + 254 + (-50.8)
  treasury_stock: -80,              // held flat
  accumulated_oci: 30,              // held flat
  total_equity: 953.4,              // 424.2 + 579.2 + (-80) + 30
  // 489.9 + 953.4 = 1443.3 = total assets.
};

/**
 * FY2026, the second forecast period. Every `[P]` here is FY2025 — a FORECAST period,
 * which is the only reason two periods are worked by hand rather than one.
 */
export const EXPECTED_FY2026: Row = {
  // ---- Income statement (5.1) ----
  revenue: 1331,                    // 1210 * 1.10
  cost_of_revenue: -798.6,          // -(1331 * 0.60)
  gross_profit: 532.4,              // 1331 + (-798.6)
  research_development: 66.55,      // 1331 * 0.05, printed positive
  selling_general_admin: 133.1,     // 1331 * 0.10, printed positive
  operating_expenses: 199.65,       // 66.55 + 133.1
  operating_income: 332.75,         // 532.4 - 199.65
  interest_expense: -18,            // -((50 + 130 + 0) * 0.10), opening debt from FY2025
  other_income_expense: 42.645,     // 15 + 552.9 * 0.05, opening cash from FY2025
  pretax_income: 357.395,           // 332.75 + (-18) + 42.645
  income_tax_expense: -71.479,      // -(357.395 * 0.20)
  net_income: 285.916,              // 357.395 + (-71.479)

  // ---- Cash flow (5.2, 5.3) ----
  cf_net_income: 285.916,
  depreciation_amortisation: 54.68, // 546.8 * 0.10, opening PP&E from FY2025
  stock_based_compensation: 26.62,  // 1331 * 0.02
  change_in_working_capital: -8.47, // -((133.1-121) + (79.86-72.6) - (119.79-108.9))
  cash_from_operations: 358.746,    // 285.916 + 54.68 + 26.62 + (-8.47)
  capital_expenditures: -106.48,    // -(1331 * 0.08)
  acquisitions: 0,
  other_investing: 0,
  cash_from_investing: -106.48,
  debt_issued_repaid: -20,
  revolver_movement: 0,
  equity_issued_repurchased: 0,
  dividends_paid: -57.1832,         // -(285.916 * 0.20)
  other_financing: 0,
  cash_from_financing: -77.1832,    // -20 + 0 + 0 + (-57.1832) + 0
  fx_effect_on_cash: 0,
  net_change_in_cash: 175.0828,     // 358.746 + (-106.48) + (-77.1832)

  // ---- Balance sheet (5.4) ----
  // Plug: 552.9 + 175.0828 = 727.9828 >= 400, revolver[P] = 0, nothing repaid.
  cash_and_equivalents: 727.9828,
  short_term_investments: 20,
  accounts_receivable: 133.1,       // 0.10 * 1331
  inventory: 79.86,                 // 0.10 * 798.6
  other_current_assets: 24,
  total_current_assets: 984.9428,   // 727.9828 + 20 + 133.1 + 79.86 + 24
  property_plant_equipment: 598.6,  // 546.8 + 106.48 - 54.68
  goodwill: 50,
  intangible_assets: 30,
  other_noncurrent_assets: 26,
  total_assets: 1689.5428,          // 984.9428 + 598.6 + 50 + 30 + 26
  accounts_payable: 119.79,         // 0.15 * 798.6
  accrued_liabilities: 60,
  deferred_revenue_current: 40,
  short_term_debt: 50,
  revolver: 0,
  other_current_liabilities: 21,
  total_current_liabilities: 290.79,// 119.79 + 60 + 40 + 50 + 0 + 21
  long_term_debt: 110,              // max(130 - 20, 0)
  other_noncurrent_liabilities: 80,
  total_liabilities: 480.79,        // 290.79 + 110 + 80
  common_stock_apic: 450.82,        // 424.2 + 26.62
  retained_earnings: 807.9328,      // 579.2 + 285.916 + (-57.1832)
  treasury_stock: -80,
  accumulated_oci: 30,
  total_equity: 1208.7528,          // 450.82 + 807.9328 + (-80) + 30
  // 480.79 + 1208.7528 = 1689.5428 = total assets.
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

// ---- The positive-cost fixture --------------------------------------------------
//
// The same company filing under the opposite convention: costs and outflows printed
// positive, the way plenty of filings present them. The forecast must come out in ITS
// convention, not the engine's internal one, or the history and forecast columns sit
// side by side with opposite signs on the same line.

/**
 * The income-statement keys whose sign is a presentation choice rather than arithmetic,
 * and which the forecast therefore prints in the workspace's own convention. Must match
 * the engine's `SIGN_OBSERVED_KEYS`; a test asserts it does.
 */
export const SIGN_FLIPPED_KEYS = [
  "cost_of_revenue", "interest_expense", "income_tax_expense",
  "research_development", "selling_general_admin",
];

/**
 * The cash-flow outflows a costs-positive filing ALSO prints positive, and which the
 * forecast nonetheless keeps negative. The cash-flow statement aggregates signed cash
 * effects by addition, so `+96.8` of capital expenditure would make the displayed
 * sections disagree with the displayed bottom line. A filing may present it either way;
 * a working model may not.
 */
export const POSITIVE_HISTORY_ONLY_KEYS = ["capital_expenditures", "dividends_paid"];

function withPositiveCosts(row: Row): Row {
  const out: Row = { ...row };
  for (const key of [...SIGN_FLIPPED_KEYS, ...POSITIVE_HISTORY_ONLY_KEYS]) {
    if (out[key] !== undefined) out[key] = Math.abs(out[key]);
  }
  return out;
}

/** The three historical years, printed with costs positive throughout. */
export function positiveCostRows(): Record<string, Row> {
  const base = historicalRows();
  const rows: Record<string, Row> = {};
  for (const [period, row] of Object.entries(base)) rows[period] = withPositiveCosts(row);
  return rows;
}

export function positiveCostForecastInput(options: EngineFixtureOptions = {}): FixtureForecastInput {
  return fixtureForecastInput({ ...options, rows: options.rows ?? positiveCostRows() });
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

/**
 * Plugged cash and the financing lines that carry the revolver movement. Nothing else
 * moves financing in this fixture, so `cash_from_financing` is exactly the movement.
 */
export const EXPECTED_PLUG_CASH: Record<string, {
  cash: number; revolverMovement: number; cashFromFinancing: number; netChangeInCash: number;
}> = {
  FY2025: { cash: 1000, revolverMovement: 150, cashFromFinancing: 150, netChangeInCash: 0 },
  FY2026: { cash: 1000, revolverMovement: -50, cashFromFinancing: -50, netChangeInCash: 0 },
  FY2027: { cash: 1100, revolverMovement: -100, cashFromFinancing: -100, netChangeInCash: 100 },
  FY2028: { cash: 1200, revolverMovement: 0, cashFromFinancing: 0, netChangeInCash: 100 },
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
