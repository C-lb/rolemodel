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
