import { buildWorkspace, type WorkspaceInput, type WorkspaceView } from "../workspace";
import type { Provenance } from "@/db/schema";

/**
 * A three-period model with round numbers, chosen so every ratio in the library has an
 * answer that can be worked out on paper. The expectations in the tests are written as
 * literals from that arithmetic, never computed with the code under test.
 *
 * Interest expense and capital expenditure are stored negative on purpose: they are the
 * sign-normalisation cases, and a fixture that stores them positive would never exercise
 * the rule.
 */

const PROVENANCE: Provenance = {
  page: 1,
  sheet: null,
  locator: "p1",
  rawLabel: "fixture",
  rawValue: "fixture",
  scaleFactor: 1,
  scaleEvidence: "fixture",
  signFlipped: false,
};

type Row = Record<string, number>;

export const FY2022: Row = {
  // income
  revenue: 10000,
  cost_of_revenue: 6000,
  gross_profit: 4000,
  operating_expenses: 2000,
  operating_income: 2000,
  interest_expense: -200,
  pretax_income: 1800,
  income_tax_expense: 400,
  net_income: 1400,
  // balance
  cash_and_equivalents: 1000,
  short_term_investments: 500,
  accounts_receivable: 2000,
  inventory: 1500,
  total_current_assets: 5000,
  property_plant_equipment: 4000,
  goodwill: 1000,
  total_assets: 10000,
  accounts_payable: 1000,
  accrued_liabilities: 500,
  short_term_debt: 500,
  total_current_liabilities: 2000,
  long_term_debt: 3000,
  total_liabilities: 5000,
  total_equity: 5000,
  // cash flow
  depreciation_amortisation: 500,
  cash_from_operations: 1800,
  capital_expenditures: -800,
};

export const FY2023: Row = {
  revenue: 12000,
  cost_of_revenue: 7200,
  gross_profit: 4800,
  operating_expenses: 2400,
  operating_income: 2400,
  interest_expense: -240,
  pretax_income: 2160,
  income_tax_expense: 460,
  net_income: 1700,
  cash_and_equivalents: 1200,
  short_term_investments: 800,
  accounts_receivable: 2400,
  inventory: 1600,
  total_current_assets: 6000,
  property_plant_equipment: 4500,
  goodwill: 1500,
  total_assets: 12000,
  accounts_payable: 1200,
  accrued_liabilities: 600,
  short_term_debt: 600,
  total_current_liabilities: 2400,
  long_term_debt: 3600,
  total_liabilities: 6000,
  total_equity: 6000,
  depreciation_amortisation: 600,
  cash_from_operations: 2200,
  capital_expenditures: -900,
};

export const FY2024: Row = {
  revenue: 15000,
  cost_of_revenue: 9000,
  gross_profit: 6000,
  operating_expenses: 3000,
  operating_income: 3000,
  interest_expense: -300,
  pretax_income: 2700,
  income_tax_expense: 600,
  net_income: 2100,
  cash_and_equivalents: 1500,
  short_term_investments: 1000,
  accounts_receivable: 2800,
  inventory: 1700,
  total_current_assets: 7000,
  property_plant_equipment: 5000,
  goodwill: 2000,
  total_assets: 14000,
  accounts_payable: 1400,
  accrued_liabilities: 700,
  short_term_debt: 700,
  total_current_liabilities: 2800,
  long_term_debt: 4200,
  total_liabilities: 7000,
  total_equity: 7000,
  depreciation_amortisation: 700,
  cash_from_operations: 2600,
  capital_expenditures: -1000,
};

export interface FixtureOptions {
  /** Period key to row. Defaults to the three full years above, most recent first. */
  rows?: Record<string, Row>;
  overrides?: { canonicalKey: string; periodKey: string; value: number }[];
  /** Confidence for every fact unless a key appears in `confidenceByKey`. */
  confidence?: number;
  confidenceByKey?: Record<string, number>;
}

export function fixtureInput(options: FixtureOptions = {}): WorkspaceInput {
  const rows = options.rows ?? { FY2024, FY2023, FY2022 };
  const facts = Object.entries(rows).flatMap(([periodKey, row]) =>
    Object.entries(row).map(([canonicalKey, value]) => ({
      canonicalKey,
      periodKey,
      value,
      confidence: options.confidenceByKey?.[canonicalKey] ?? options.confidence ?? 0.95,
      provenance: PROVENANCE,
    })),
  );

  return {
    periods: Object.keys(rows),
    facts,
    overrides: options.overrides ?? [],
  };
}

export function fixtureWorkspace(options: FixtureOptions = {}): WorkspaceView {
  return buildWorkspace(fixtureInput(options));
}

/** The three years with a single line item removed, for the `unavailable` paths. */
export function withoutKeys(keys: string[], options: FixtureOptions = {}): FixtureOptions {
  const rows = options.rows ?? { FY2024, FY2023, FY2022 };
  const stripped: Record<string, Row> = {};
  for (const [period, row] of Object.entries(rows)) {
    const copy = { ...row };
    for (const key of keys) delete copy[key];
    stripped[period] = copy;
  }
  return { ...options, rows: stripped };
}
