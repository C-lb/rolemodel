/**
 * The driver catalogue: the seventeen assumptions the forecast engine reads, one per
 * scenario per forecast period. This is the forecast layer's analogue of
 * `model/ratios/library.ts` — a fixed list of definitions, not a formula engine, so the
 * UI and the engine both read the same authored text and the same unit.
 *
 * Every driver exists for every forecast period from the moment a scenario is created —
 * there is no "unset means inherit" rule — so `DRIVER_DEFAULTS` below covers all
 * seventeen keys, never a subset.
 */

/** Drives formatting and storage convention, not arithmetic. */
export type DriverUnit = "percent" | "days" | "currency";

export interface DriverDef {
  key: string;
  label: string;
  unit: DriverUnit;
  /** Authored, deterministic. What the driver does to the model, in prose a user wants to read. */
  definition: string;
  /** The short hover text — a sentence, not the full definition. */
  tooltip: string;
}

export const DRIVERS: readonly DriverDef[] = [
  {
    key: "revenue_growth",
    label: "Revenue growth",
    unit: "percent",
    definition:
      "The rate revenue grows against the prior period, stored as a decimal (0.03 means 3%). The engine multiplies the prior period's revenue by one plus this rate to produce the forecast period's revenue, which every percent-of-revenue driver below is then measured against.",
    tooltip: "Revenue growth against the prior period, as a decimal.",
  },
  {
    key: "gross_margin",
    label: "Gross margin",
    unit: "percent",
    definition:
      "Gross profit as a share of revenue, stored as a decimal. The engine applies this directly to forecast revenue to produce gross profit, so cost of revenue is whatever residual that implies rather than something separately assumed.",
    tooltip: "Gross profit as a share of revenue, as a decimal.",
  },
  {
    key: "rd_pct_revenue",
    label: "R&D as % of revenue",
    unit: "percent",
    definition:
      "Research and development expense as a share of revenue, stored as a decimal. The engine multiplies forecast revenue by this rate to produce the R&D line directly.",
    tooltip: "Research and development spend as a share of revenue, as a decimal.",
  },
  {
    key: "sga_pct_revenue",
    label: "SG&A as % of revenue",
    unit: "percent",
    definition:
      "Selling, general and administrative expense as a share of revenue, stored as a decimal. The engine multiplies forecast revenue by this rate to produce the SG&A line directly.",
    tooltip: "Selling, general and administrative spend as a share of revenue, as a decimal.",
  },
  {
    key: "sbc_pct_revenue",
    label: "Stock-based compensation as % of revenue",
    unit: "percent",
    definition:
      "Stock-based compensation as a share of revenue, stored as a decimal. Held separate from SG&A because it is a non-cash charge the cash flow statement needs to add back on its own line.",
    tooltip: "Stock-based compensation as a share of revenue, as a decimal.",
  },
  {
    key: "other_income_expense",
    label: "Other income / expense",
    unit: "currency",
    definition:
      "A currency amount, in the same units as the statements, held flat across the forecast rather than scaled to revenue, because this line is typically a grab bag of items with no consistent relationship to sales. The engine adds interest earned on opening cash on top of this figure rather than folding it in, so the two sources stay distinguishable.",
    tooltip: "Other income or expense, held flat, before interest on opening cash.",
  },
  {
    key: "dso",
    label: "Days sales outstanding",
    unit: "days",
    definition:
      "The number of days of revenue sitting in accounts receivable, stored as a day count (45, not 0.123). The engine uses it to size the forecast receivables balance from forecast revenue, and the change in that balance flows into the cash flow statement as a working-capital movement.",
    tooltip: "Days of revenue carried as accounts receivable.",
  },
  {
    key: "dio",
    label: "Days inventory outstanding",
    unit: "days",
    definition:
      "The number of days of cost of revenue sitting in inventory, stored as a day count. The engine uses it to size the forecast inventory balance from forecast cost of revenue, and the change in that balance flows into the cash flow statement as a working-capital movement.",
    tooltip: "Days of cost of revenue carried as inventory.",
  },
  {
    key: "dpo",
    label: "Days payable outstanding",
    unit: "days",
    definition:
      "The number of days of cost of revenue sitting in accounts payable, stored as a day count. The engine uses it to size the forecast payables balance from forecast cost of revenue, and the change in that balance flows into the cash flow statement as a working-capital movement.",
    tooltip: "Days of cost of revenue carried as accounts payable.",
  },
  {
    key: "capex_pct_revenue",
    label: "Capex as % of revenue",
    unit: "percent",
    definition:
      "Capital expenditure as a share of revenue, stored as a decimal. The engine multiplies forecast revenue by this rate to produce capex, which reduces cash and increases the opening PP&E balance carried into the next period.",
    tooltip: "Capital expenditure as a share of revenue, as a decimal.",
  },
  {
    key: "depreciation_pct_ppe",
    label: "Depreciation as % of PP&E",
    unit: "percent",
    definition:
      "Depreciation and amortisation as a share of opening property, plant and equipment, stored as a decimal. The engine applies this to the balance carried in from the prior period, before that period's capex is added, so a big capex year does not inflate its own depreciation charge.",
    tooltip: "Depreciation as a share of opening PP&E, as a decimal.",
  },
  {
    key: "tax_rate",
    label: "Tax rate",
    unit: "percent",
    definition:
      "The rate applied to pre-tax income when it is positive, stored as a decimal. The engine leaves tax at zero on a forecast loss rather than generating a tax benefit, on the view that a model should not assume a refund it cannot substantiate.",
    tooltip: "Tax on positive pre-tax income, as a decimal.",
  },
  {
    key: "dividend_payout",
    label: "Dividend payout",
    unit: "percent",
    definition:
      "The share of positive net income paid out as dividends, stored as a decimal. The engine pays nothing on a forecast loss, and what is retained flows into the closing equity balance.",
    tooltip: "Dividends as a share of positive net income, as a decimal.",
  },
  {
    key: "interest_rate_debt",
    label: "Interest rate on debt",
    unit: "percent",
    definition:
      "The annual rate charged on opening total debt, including any revolver balance, stored as a decimal. The engine applies this to the balance carried in from the prior period, so a period's own borrowing or repayment does not affect its own interest charge.",
    tooltip: "Interest rate on opening total debt, including the revolver, as a decimal.",
  },
  {
    key: "interest_rate_cash",
    label: "Interest rate on cash",
    unit: "percent",
    definition:
      "The annual rate earned on opening cash, stored as a decimal. The engine applies this to the cash balance carried in from the prior period and adds the result on top of other income and expense.",
    tooltip: "Interest earned on opening cash, as a decimal.",
  },
  {
    key: "debt_repayment",
    label: "Debt repayment",
    unit: "currency",
    definition:
      "A currency amount, in the same units as the statements, for the scheduled repayment of long-term debt in the period. A positive value repays debt and reduces cash; the engine does not infer a repayment schedule on its own.",
    tooltip: "Scheduled long-term debt repayment for the period. Positive means repay.",
  },
  {
    key: "min_cash",
    label: "Minimum cash",
    unit: "currency",
    definition:
      "A currency amount, in the same units as the statements, for the cash floor the revolver defends. When forecast cash would fall below this level, the engine draws on the revolver to bring cash back up to it; when cash is comfortably above it, the engine sweeps the surplus to pay the revolver down.",
    tooltip: "The cash floor the revolver draws on to defend.",
  },
];

export const DRIVER_KEYS: readonly string[] = DRIVERS.map((d) => d.key);

const BY_KEY = new Map(DRIVERS.map((d) => [d.key, d]));

export function driver(key: string): DriverDef | undefined {
  return BY_KEY.get(key);
}

/**
 * Spec 4.1 names defaults only for the drivers where zero would be a bad guess:
 * modest growth, a plausible tax rate, a small return on cash, and no assumed dividend
 * or repayment. Every other driver is a percent-of-revenue, days, or held-flat line
 * where the safest starting assumption is zero — no growth in the underlying activity,
 * no days of working capital, no discretionary spend — until seeding from history
 * replaces it with something better.
 */
export const DRIVER_DEFAULTS: Readonly<Record<string, number>> = {
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
