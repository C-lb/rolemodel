import { DRIVER_KEYS, DRIVER_DEFAULTS } from "./drivers";
import { isImmediatePredecessor, sortPeriodsMostRecentFirst } from "../periods";

export type DriverBasis = "derived" | "default";

export interface SeededDriver {
  key: string;
  value: number;
  basis: DriverBasis;
  note: string;
}

export interface SeedInput {
  periods: string[];
  valueAt(key: string, period: string): number | undefined;
}

const DAYS_IN_YEAR = 365;
const TAX_RATE_MIN = 0;
const TAX_RATE_MAX = 0.5;
const INTEREST_RATE_DEBT_MIN = 0;
const INTEREST_RATE_DEBT_MAX = 0.25;
const DIVIDEND_PAYOUT_MIN = 0;
const DIVIDEND_PAYOUT_MAX = 1;

type Seeded = Omit<SeededDriver, "key">;
type DeriveFn = (input: SeedInput) => Seeded;

function derived(value: number, note: string): Seeded {
  return { value, basis: "derived", note };
}

function fallback(key: string, note: string): Seeded {
  return { value: DRIVER_DEFAULTS[key], basis: "default", note };
}

/** Most recent period first, and the one immediately before it — only when it truly is. */
function latestAndImmediatePrior(input: SeedInput): { latest: string | undefined; prior: string | undefined } {
  const ordered = sortPeriodsMostRecentFirst(input.periods);
  const latest = ordered[0];
  const candidate = ordered[1];
  const prior = latest !== undefined && candidate !== undefined && isImmediatePredecessor(latest, candidate)
    ? candidate
    : undefined;
  return { latest, prior };
}

function latestPeriod(input: SeedInput): string | undefined {
  return sortPeriodsMostRecentFirst(input.periods)[0];
}

// ---- Per-driver seeding rules --------------------------------------------------

function deriveRevenueGrowth(input: SeedInput): Seeded {
  const { latest, prior } = latestAndImmediatePrior(input);
  if (latest === undefined || prior === undefined) {
    return fallback(
      "revenue_growth",
      "The two most recent historical periods are not adjacent, so a period-over-period growth rate cannot be computed.",
    );
  }
  const revenueLatest = input.valueAt("revenue", latest);
  const revenuePrior = input.valueAt("revenue", prior);
  if (revenueLatest === undefined || revenuePrior === undefined) {
    return fallback("revenue_growth", "Revenue is missing in the latest or the prior historical period.");
  }
  if (revenuePrior === 0) {
    return fallback("revenue_growth", "Prior-period revenue is zero, so a growth rate cannot be computed.");
  }
  const value = (revenueLatest - revenuePrior) / revenuePrior;
  if (!Number.isFinite(value)) {
    return fallback("revenue_growth", "The computed revenue growth rate is not a finite number.");
  }
  return derived(value, `Computed as (revenue at ${latest} - revenue at ${prior}) / revenue at ${prior}.`);
}

/**
 * A percent-of-revenue driver: `|numerator(latest)| / revenue(latest)`. `numeratorKey`
 * is always a cost or expense line, structurally one-signed, so its magnitude is what
 * is divided by revenue regardless of which sign convention the source document used.
 */
function percentOfRevenue(key: string, numeratorKey: string): DeriveFn {
  return (input) => {
    const latest = latestPeriod(input);
    if (latest === undefined) return fallback(key, "No historical period is available.");
    const revenue = input.valueAt("revenue", latest);
    if (revenue === undefined || revenue === 0) {
      return fallback(key, `Revenue is missing or zero at ${latest}, so a share of revenue cannot be computed.`);
    }
    const numerator = input.valueAt(numeratorKey, latest);
    if (numerator === undefined) {
      return fallback(key, `${numeratorKey} is missing at ${latest}.`);
    }
    const value = Math.abs(numerator) / revenue;
    if (!Number.isFinite(value)) return fallback(key, `The computed value for ${key} is not a finite number.`);
    return derived(value, `Computed as |${numeratorKey}| / revenue at ${latest}.`);
  };
}

function deriveGrossMargin(input: SeedInput): Seeded {
  const latest = latestPeriod(input);
  if (latest === undefined) return fallback("gross_margin", "No historical period is available.");
  const revenue = input.valueAt("revenue", latest);
  if (revenue === undefined || revenue === 0) {
    return fallback("gross_margin", `Revenue is missing or zero at ${latest}, so gross margin cannot be computed.`);
  }
  const costOfRevenue = input.valueAt("cost_of_revenue", latest);
  if (costOfRevenue === undefined) {
    return fallback("gross_margin", `cost_of_revenue is missing at ${latest}.`);
  }
  // cost_of_revenue is a structurally one-signed cost line whose stored sign varies by
  // document (prompt.ts keeps whatever sign the filing used), so its magnitude, not an
  // assumed sign, is what's subtracted from revenue.
  const value = (revenue - Math.abs(costOfRevenue)) / revenue;
  if (!Number.isFinite(value)) return fallback("gross_margin", "The computed gross margin is not a finite number.");
  return derived(value, `Computed as (revenue - |cost_of_revenue|) / revenue at ${latest}.`);
}

/** capex_pct_revenue: capital_expenditures is a one-signed outflow, so its magnitude is what's divided by revenue. */
function deriveCapexPctRevenue(input: SeedInput): Seeded {
  const latest = latestPeriod(input);
  if (latest === undefined) return fallback("capex_pct_revenue", "No historical period is available.");
  const revenue = input.valueAt("revenue", latest);
  if (revenue === undefined || revenue === 0) {
    return fallback("capex_pct_revenue", `Revenue is missing or zero at ${latest}.`);
  }
  const capex = input.valueAt("capital_expenditures", latest);
  if (capex === undefined) return fallback("capex_pct_revenue", `capital_expenditures is missing at ${latest}.`);
  const value = Math.abs(capex) / revenue;
  if (!Number.isFinite(value)) return fallback("capex_pct_revenue", "The computed value is not a finite number.");
  return derived(value, `Computed as |capital_expenditures| / revenue at ${latest}.`);
}

/** A day-count driver: `balance(latest) / |flow(latest)| * 365`. `flow` is a one-signed line, read as a magnitude. */
function daysOf(key: string, balanceKey: string, flowKey: string): DeriveFn {
  return (input) => {
    const latest = latestPeriod(input);
    if (latest === undefined) return fallback(key, "No historical period is available.");
    const balance = input.valueAt(balanceKey, latest);
    if (balance === undefined) return fallback(key, `${balanceKey} is missing at ${latest}.`);
    const rawFlow = input.valueAt(flowKey, latest);
    if (rawFlow === undefined) return fallback(key, `${flowKey} is missing at ${latest}.`);
    const flow = Math.abs(rawFlow);
    // Reject non-positive, not just missing: a zero-flow line would otherwise silently
    // produce a zero or infinite day count rather than falling back.
    if (flow <= 0) {
      return fallback(key, `${flowKey} at ${latest} is zero, so a day count cannot be computed.`);
    }
    const value = (balance / flow) * DAYS_IN_YEAR;
    if (!Number.isFinite(value)) return fallback(key, "The computed day count is not a finite number.");
    return derived(value, `Computed as ${balanceKey} / |${flowKey}| * 365 at ${latest}.`);
  };
}

function deriveDepreciationPctPpe(input: SeedInput): Seeded {
  // Same-period PP&E, not the opening (prior-period) balance the forecast engine uses:
  // at the seam there is no earlier PP&E balance to open from, so seeding reads
  // depreciation and PP&E from the same, most recent, historical period.
  const latest = latestPeriod(input);
  if (latest === undefined) return fallback("depreciation_pct_ppe", "No historical period is available.");
  const ppe = input.valueAt("property_plant_equipment", latest);
  if (ppe === undefined || ppe === 0) {
    return fallback("depreciation_pct_ppe", `property_plant_equipment is missing or zero at ${latest}.`);
  }
  const depreciation = input.valueAt("depreciation_amortisation", latest);
  if (depreciation === undefined) {
    return fallback("depreciation_pct_ppe", `depreciation_amortisation is missing at ${latest}.`);
  }
  const value = depreciation / ppe;
  if (!Number.isFinite(value)) return fallback("depreciation_pct_ppe", "The computed value is not a finite number.");
  return derived(value, `Computed as depreciation_amortisation / property_plant_equipment at ${latest}.`);
}

function deriveTaxRate(input: SeedInput): Seeded {
  const latest = latestPeriod(input);
  if (latest === undefined) return fallback("tax_rate", "No historical period is available.");
  const pretaxIncome = input.valueAt("pretax_income", latest);
  if (pretaxIncome === undefined || pretaxIncome <= 0) {
    return fallback(
      "tax_rate",
      `pretax_income at ${latest} is missing or not positive, so a tax rate cannot be computed.`,
    );
  }
  const incomeTaxExpense = input.valueAt("income_tax_expense", latest);
  if (incomeTaxExpense === undefined) return fallback("tax_rate", `income_tax_expense is missing at ${latest}.`);
  // income_tax_expense is a one-signed cost line; its magnitude is divided by pretax income.
  const value = Math.abs(incomeTaxExpense) / pretaxIncome;
  if (!Number.isFinite(value) || value < TAX_RATE_MIN || value > TAX_RATE_MAX) {
    return fallback(
      "tax_rate",
      `The computed tax rate at ${latest} falls outside the plausible ${TAX_RATE_MIN}–${TAX_RATE_MAX} range.`,
    );
  }
  return derived(value, `Computed as |income_tax_expense| / pretax_income at ${latest}.`);
}

function deriveInterestRateDebt(input: SeedInput): Seeded {
  const latest = latestPeriod(input);
  if (latest === undefined) return fallback("interest_rate_debt", "No historical period is available.");
  const shortTermDebt = input.valueAt("short_term_debt", latest) ?? 0;
  const longTermDebt = input.valueAt("long_term_debt", latest) ?? 0;
  // revolver is absentMeansZero: it never appears in a historical document, so its
  // absence is a genuine zero, not a missing input.
  const revolver = input.valueAt("revolver", latest) ?? 0;
  const openingDebt = shortTermDebt + longTermDebt + revolver;
  if (openingDebt <= 0) {
    return fallback("interest_rate_debt", `Total debt at ${latest} is zero, so an interest rate cannot be computed.`);
  }
  const interestExpense = input.valueAt("interest_expense", latest);
  if (interestExpense === undefined) {
    return fallback("interest_rate_debt", `interest_expense is missing at ${latest}.`);
  }
  // interest_expense is a one-signed cost line; its magnitude is divided by debt.
  const value = Math.abs(interestExpense) / openingDebt;
  if (!Number.isFinite(value) || value < INTEREST_RATE_DEBT_MIN || value > INTEREST_RATE_DEBT_MAX) {
    return fallback(
      "interest_rate_debt",
      `The computed interest rate at ${latest} falls outside the plausible ${INTEREST_RATE_DEBT_MIN}–${INTEREST_RATE_DEBT_MAX} range.`,
    );
  }
  return derived(
    value,
    `Computed as |interest_expense| / (short_term_debt + long_term_debt + revolver) at ${latest}.`,
  );
}

function deriveMinCash(input: SeedInput): Seeded {
  const latest = latestPeriod(input);
  if (latest === undefined) return fallback("min_cash", "No historical period is available.");
  const cash = input.valueAt("cash_and_equivalents", latest);
  if (cash === undefined) {
    return fallback("min_cash", `cash_and_equivalents is missing at ${latest}.`);
  }
  return derived(cash, `Set to the cash_and_equivalents balance at ${latest}, so period one draws no revolver.`);
}

/**
 * "Held flat" means flat at the last actual, not flat at zero: this is a real
 * income-statement line, so the seed is its value in the most recent historical period.
 */
function deriveOtherIncomeExpense(input: SeedInput): Seeded {
  const latest = latestPeriod(input);
  if (latest === undefined) return fallback("other_income_expense", "No historical period is available.");
  const value = input.valueAt("other_income_expense", latest);
  if (value === undefined) {
    return fallback("other_income_expense", `other_income_expense is missing at ${latest}.`);
  }
  return derived(value, `Held flat at the other_income_expense value from ${latest}.`);
}

function deriveDividendPayout(input: SeedInput): Seeded {
  const latest = latestPeriod(input);
  if (latest === undefined) return fallback("dividend_payout", "No historical period is available.");
  const netIncome = input.valueAt("net_income", latest);
  if (netIncome === undefined || netIncome <= 0) {
    return fallback(
      "dividend_payout",
      `net_income at ${latest} is missing or not positive, so a payout ratio cannot be computed.`,
    );
  }
  const dividendsPaid = input.valueAt("dividends_paid", latest);
  if (dividendsPaid === undefined) {
    return fallback("dividend_payout", `dividends_paid is missing at ${latest}.`);
  }
  // dividends_paid is a one-signed outflow; its magnitude is divided by net income.
  const magnitude = Math.abs(dividendsPaid);
  if (magnitude <= 0) {
    return fallback("dividend_payout", `No dividends were paid at ${latest}.`);
  }
  const value = magnitude / netIncome;
  if (!Number.isFinite(value) || value < DIVIDEND_PAYOUT_MIN || value > DIVIDEND_PAYOUT_MAX) {
    return fallback(
      "dividend_payout",
      `The computed payout ratio at ${latest} falls outside the plausible ${DIVIDEND_PAYOUT_MIN}–${DIVIDEND_PAYOUT_MAX} range.`,
    );
  }
  return derived(value, `Computed as |dividends_paid| / net_income at ${latest}.`);
}

/** No line item in the taxonomy lets this driver be read from a historical statement. */
function alwaysDefault(key: string, why: string): DeriveFn {
  return () => fallback(key, why);
}

const DERIVERS: Readonly<Record<string, DeriveFn>> = {
  revenue_growth: deriveRevenueGrowth,
  gross_margin: deriveGrossMargin,
  rd_pct_revenue: percentOfRevenue("rd_pct_revenue", "research_development"),
  sga_pct_revenue: percentOfRevenue("sga_pct_revenue", "selling_general_admin"),
  sbc_pct_revenue: percentOfRevenue("sbc_pct_revenue", "stock_based_compensation"),
  other_income_expense: deriveOtherIncomeExpense,
  dso: daysOf("dso", "accounts_receivable", "revenue"),
  dio: daysOf("dio", "inventory", "cost_of_revenue"),
  dpo: daysOf("dpo", "accounts_payable", "cost_of_revenue"),
  capex_pct_revenue: deriveCapexPctRevenue,
  depreciation_pct_ppe: deriveDepreciationPctPpe,
  tax_rate: deriveTaxRate,
  dividend_payout: deriveDividendPayout,
  interest_rate_debt: deriveInterestRateDebt,
  interest_rate_cash: alwaysDefault(
    "interest_rate_cash",
    "Held at the documented default; interest income is embedded inside other_income_expense and is not reported as a separate line, so there is no honest way to derive this rate from history.",
  ),
  debt_repayment: alwaysDefault(
    "debt_repayment",
    "Held at the documented default; debt_issued_repaid is a net figure, and splitting it into issuance versus repayment would be guesswork.",
  ),
  min_cash: deriveMinCash,
};

/**
 * Seeds a starting value for every driver in `DRIVER_KEYS` from the supplied history,
 * following spec 4.1. One small function per driver, looked up from a table — never a
 * seventeen-branch switch.
 */
export function deriveDrivers(input: SeedInput): SeededDriver[] {
  return DRIVER_KEYS.map((key) => {
    const fn = DERIVERS[key];
    const seeded = fn ? fn(input) : fallback(key, "No seeding rule is defined for this driver.");
    return { key, ...seeded };
  });
}

const BULL_BEAR_STEP: Readonly<Record<"revenue_growth" | "gross_margin", number>> = {
  revenue_growth: 0.03,
  gross_margin: 0.01,
};

/**
 * Base is the seeded values unchanged. Bull nudges `revenue_growth` up 300bps and
 * `gross_margin` up 100bps; bear nudges both the other way, flooring `gross_margin`
 * at zero rather than letting it go negative. Every other driver is untouched.
 */
export function scenarioSeed(base: SeededDriver[], kind: "base" | "bull" | "bear"): SeededDriver[] {
  if (kind === "base") return base.map((d) => ({ ...d }));

  const sign = kind === "bull" ? 1 : -1;
  return base.map((d) => {
    if (d.key === "revenue_growth") {
      return { ...d, value: d.value + sign * BULL_BEAR_STEP.revenue_growth };
    }
    if (d.key === "gross_margin") {
      const value = d.value + sign * BULL_BEAR_STEP.gross_margin;
      return { ...d, value: kind === "bear" ? Math.max(0, value) : value };
    }
    return { ...d };
  });
}
