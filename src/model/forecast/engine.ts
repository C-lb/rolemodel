import { TAXONOMY, lineItem } from "../taxonomy";
import { sortPeriodsMostRecentFirst } from "../periods";
import { DRIVER_DEFAULTS, DRIVER_KEYS, driver } from "./drivers";
import type { DriverBasis } from "./seed";
import type { Finding } from "../validate";

/**
 * The forecast engine. Spec section 5.
 *
 * Acyclic by construction: every balance-sheet reference inside a period is an OPENING
 * balance, read through `openingAt` and nowhere else, so interest is charged on the debt
 * carried in rather than the debt carried out and there is no circular reference to
 * iterate. The cost is a small understatement of interest in a heavy borrowing year;
 * the benefit is that every cell has exactly one evaluation and one explanation.
 *
 * `formula` and `inputs` on each cell are populated from the operands actually used, at
 * the moment the value is computed. They are not re-derived afterwards from a table of
 * format strings, because a table drifts from the arithmetic and then lies to the
 * provenance panel that renders it.
 */

export interface ForecastInput {
  /** Historical period keys, in any order. The highest-ranked one is the base. */
  historicalPeriods: string[];
  /** Forecast period keys, evaluated in the order given. */
  forecastPeriods: string[];
  valueAt(key: string, period: string): number | undefined;
  driverAt(key: string, period: string): number | undefined;
  /** Optional. Supplying it is the only way `forecast_driver_default` can ever fire. */
  driverBasisAt?(key: string, period: string): DriverBasis | undefined;
}

export interface PlugDetail {
  periodKey: string;
  cashBeforePlug: number;
  drawn: number;
  repaid: number;
  revolverBalance: number;
}

export interface ForecastCell {
  canonicalKey: string;
  periodKey: string;
  value: number;
  /** Human-readable arithmetic, e.g. "revenue[FY2024] * (1 + revenue_growth)". */
  formula: string;
  /** The operands that formula names, with the values actually used. */
  inputs: { label: string; value: number }[];
}

export interface ForecastResult {
  ok: boolean;
  cells: ForecastCell[];
  plugs: PlugDetail[];
  findings: Finding[];
  valueAt(key: string, period: string): number | undefined;
}

const ANNUAL_PERIOD = /^FY\d{4}$/;
const DAYS_IN_YEAR = 365;

/**
 * `closeEnough` in `../tolerance` allows `max(1, 0.005 * scale)`, which is right for
 * comparing two independently extracted money figures and far too loose here: on a 1443
 * balance sheet it permits a seven-unit break, so how sensitive the articulation guard
 * is ends up decided by how big the test fixture happens to be rather than by the
 * engine. Spec section 5.5 closes as an algebraic identity, so the only residual is
 * floating-point noise — around 1e-12 at these magnitudes. Same reasoning as
 * `ratiosAgree` in `ratios/compute.ts`, opposite direction.
 */
export function articulates(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(1e-6, scale * 1e-9);
}

/**
 * Held flat at the opening balance (spec 5.4). Absent in history means flat at zero:
 * a balance the extraction never saw cannot be held flat at an unknown, and zero in
 * both periods leaves the articulation invariant untouched.
 */
const HELD_FLAT_KEYS: ReadonlySet<string> = new Set([
  "short_term_investments", "other_current_assets", "goodwill", "intangible_assets",
  "other_noncurrent_assets", "accrued_liabilities", "deferred_revenue_current",
  "other_current_liabilities", "short_term_debt", "other_noncurrent_liabilities",
  "treasury_stock", "accumulated_oci",
]);

/** Held at zero rather than at their last actual (spec 5.2). */
const HELD_AT_ZERO_KEYS: readonly string[] = [
  "acquisitions", "other_investing", "equity_issued_repurchased", "other_financing",
];

/**
 * Lines whose sign is a reporting convention rather than arithmetic. The engine computes
 * every one of them in spec 5.1's convention internally — costs negative, so that
 * `gross_profit = revenue + cost_of_revenue` is addition and nothing has to know which
 * way a particular filing prints — and then flips the emitted value to match whatever
 * convention the workspace's own history used. A filing that prints cost of revenue
 * positive gets a forecast that prints it positive too, rather than a sign flip at the
 * history/forecast seam.
 */
const SIGN_OBSERVED_KEYS: ReadonlySet<string> = new Set([
  "cost_of_revenue", "interest_expense", "income_tax_expense", "capital_expenditures",
  "dividends_paid", "research_development", "selling_general_admin",
]);

/**
 * The opening balances the engine rolls forward or divides by. Absent means the first
 * forecast period has nothing to start from, which is `forecast_missing_base`.
 *
 * `revolver` is on the list and is nonetheless never blocking, because the taxonomy
 * marks it `absentMeansZero`. The exemption is read off that flag rather than written
 * as a special case on the key's name, so a future forecast-only line item inherits the
 * behaviour by declaring the property, and a line item that can legitimately be missing
 * for a different reason does not get it by accident.
 */
const REQUIRED_OPENING_KEYS: readonly string[] = [
  "revenue", "cash_and_equivalents", "accounts_receivable", "inventory",
  "accounts_payable", "property_plant_equipment", "long_term_debt", "revolver",
  "common_stock_apic", "retained_earnings",
];

/**
 * The components of a subtotal that the taxonomy gives no `parentKey` children —
 * `total_assets` and `total_liabilities` are summed from the top-level lines that sit
 * between the previous total and themselves. Derived from `TAXONOMY` rather than
 * hardcoded, so a balance-sheet line added later joins the total instead of silently
 * dropping out of it.
 */
export function balanceSheetSpan(subtotalKey: string, afterKey: string | null): string[] {
  const cutoff = lineItem(subtotalKey)?.order ?? 0;
  const floor = afterKey === null ? -Infinity : (lineItem(afterKey)?.order ?? -Infinity);
  return TAXONOMY.filter((i) =>
    i.statement === "balance" &&
    i.parentKey === null &&
    i.key !== subtotalKey &&
    i.order > floor &&
    i.order < cutoff,
  ).sort((a, b) => a.order - b.order).map((i) => i.key);
}

export const TOTAL_ASSETS_PARTS = balanceSheetSpan("total_assets", null);
export const TOTAL_LIABILITIES_PARTS = balanceSheetSpan("total_liabilities", "total_assets");

function cellId(key: string, period: string): string {
  return `${key}@${period}`;
}

function driverLabel(key: string): string {
  return driver(key)?.label ?? key;
}

function itemLabel(key: string): string {
  return lineItem(key)?.label ?? key;
}

function componentsOf(subtotalKey: string): string[] {
  return TAXONOMY.filter((i) => i.parentKey === subtotalKey)
    .sort((a, b) => a.order - b.order)
    .map((i) => i.key);
}

export function runForecast(input: ForecastInput): ForecastResult {
  const findings: Finding[] = [];
  const cells: ForecastCell[] = [];
  const plugs: PlugDetail[] = [];
  /** Spec 5.1's convention. Everything the engine computes with reads this. */
  const raw = new Map<string, number>();
  /** The workspace's own convention. Everything the engine emits reads this. */
  const shown = new Map<string, number>();

  const blocked = (): ForecastResult => ({
    ok: false,
    cells: [],
    plugs: [],
    findings,
    valueAt: () => undefined,
  });

  const orderedHistory = sortPeriodsMostRecentFirst(input.historicalPeriods);

  // ---- Gate 1: the base period must be an annual one (spec 5.6) ----------------
  const basePeriod = orderedHistory[0];
  if (basePeriod === undefined || !ANNUAL_PERIOD.test(basePeriod)) {
    findings.push({
      code: "forecast_not_annual",
      severity: "blocking",
      periodKey: basePeriod ?? null,
      keys: [],
      message: basePeriod === undefined
        ? "There are no historical periods to forecast from."
        : `The most recent historical period is ${basePeriod}, which is not a full year.`,
      remediation: "A forecast extends annual periods only. Add a full-year column (FY2024) to the workspace, then run the forecast again.",
    });
    return blocked();
  }

  // ---- Gate 2: every opening balance the engine needs exists (spec 5.6) --------
  const missingBase = REQUIRED_OPENING_KEYS.filter((key) => {
    if (lineItem(key)?.absentMeansZero === true) return false;
    const v = input.valueAt(key, basePeriod);
    return v === undefined || !Number.isFinite(v);
  });
  if (missingBase.length > 0) {
    findings.push({
      code: "forecast_missing_base",
      severity: "blocking",
      periodKey: basePeriod,
      keys: missingBase,
      message: `${basePeriod} has no value for ${missingBase.map((k) => itemLabel(k)).join(", ")}, so the forecast has nothing to open from.`,
      remediation: `Map or correct ${missingBase.join(", ")} in ${basePeriod}, then run the forecast again.`,
    });
    return blocked();
  }

  /**
   * The sign this workspace's own filings printed for a line, taken from the most recent
   * historical period that reports it as anything other than zero. Not an average across
   * periods: a filing that changed convention mid-history is best represented by the one
   * the reader last saw. Zero means history is silent, and spec 5.1's convention stands.
   */
  function historicalSign(key: string): -1 | 0 | 1 {
    for (const period of orderedHistory) {
      const v = input.valueAt(key, period);
      if (v === undefined || !Number.isFinite(v) || v === 0) continue;
      return v > 0 ? 1 : -1;
    }
    return 0;
  }

  const observedSign = new Map<string, -1 | 0 | 1>(
    [...SIGN_OBSERVED_KEYS].map((key) => [key, historicalSign(key)]),
  );

  /** Spec 5.1's value, turned into the convention the workspace's history uses. */
  function asShown(key: string, value: number): number {
    const observed = observedSign.get(key) ?? 0;
    if (observed === 0 || value === 0 || !Number.isFinite(value)) return value;
    return Math.sign(value) === observed ? value : -value;
  }

  // ---- Driver provenance (spec 5.6, info) -------------------------------------
  const basisAt = input.driverBasisAt;
  if (basisAt !== undefined) {
    const defaulted = new Set<string>();
    for (const period of input.forecastPeriods) {
      for (const key of DRIVER_KEYS) {
        if (basisAt(key, period) === "default") defaulted.add(key);
      }
    }
    if (defaulted.size > 0) {
      const keys = [...defaulted];
      findings.push({
        code: "forecast_driver_default",
        severity: "info",
        periodKey: null,
        keys,
        message: `${keys.length === 1 ? "One assumption is" : `${keys.length} assumptions are`} a fallback constant rather than something derived from history: ${keys.map((k) => driverLabel(k)).join(", ")}.`,
        remediation: "Review these assumptions before relying on the forecast. History did not supply enough to derive them.",
      });
    }
  }

  /**
   * The single door onto the prior period. Every `[P]` in spec section 5 comes through
   * here, so "opening balance" cannot quietly become "closing balance" in one line out
   * of forty — depreciation on opening PP&E, interest on opening debt, and interest
   * income on opening cash all read the same helper.
   */
  function openingAt(key: string, priorPeriod: string): number {
    const forecast = raw.get(cellId(key, priorPeriod));
    if (forecast !== undefined) return forecast;
    const historical = input.valueAt(key, priorPeriod);
    if (historical !== undefined && Number.isFinite(historical)) return historical;
    if (lineItem(key)?.absentMeansZero === true) return 0;
    if (HELD_FLAT_KEYS.has(key)) return 0;
    // Unreachable for the required keys, which gate 2 has already proved present.
    return 0;
  }

  let priorPeriod = basePeriod;

  for (const period of input.forecastPeriods) {
    const prior = priorPeriod;

    /**
     * Records one cell. `value` arrives in spec 5.1's convention and is stored that way
     * for the engine's own reads; the emitted cell and `inputs` carry the workspace's
     * convention. Returns the spec-convention value, because that is what the rest of
     * section 5 does arithmetic with.
     */
    const put = (
      key: string,
      value: number,
      formula: string,
      inputs: { label: string; value: number }[],
    ): number => {
      const display = asShown(key, value);
      cells.push({ canonicalKey: key, periodKey: period, value: display, formula, inputs });
      raw.set(cellId(key, period), value);
      shown.set(cellId(key, period), display);
      return value;
    };

    const open = (key: string): number => openingAt(key, prior);

    const openInput = (key: string): { label: string; value: number } => ({
      label: `${itemLabel(key)} (opening, ${prior})`,
      value: open(key),
    });

    const d = (key: string): number => {
      const v = input.driverAt(key, period);
      return v !== undefined && Number.isFinite(v) ? v : (DRIVER_DEFAULTS[key] ?? 0);
    };

    const dInput = (key: string): { label: string; value: number } => ({
      label: driverLabel(key),
      value: d(key),
    });

    /**
     * A subtotal summed from its taxonomy components, never carried forward. Emitted in
     * the workspace's convention (so it stays the sum of the components as displayed)
     * and returned in spec 5.1's (so the arithmetic below it stays correct). The two are
     * the same number for any workspace whose filings print costs negative.
     */
    const putSubtotal = (key: string): number => {
      const parts = componentsOf(key);
      const inputs = parts.map((p) => ({ label: itemLabel(p), value: shown.get(cellId(p, period)) ?? 0 }));
      const rawValue = parts.reduce((sum, p) => sum + (raw.get(cellId(p, period)) ?? 0), 0);
      const display = inputs.reduce((sum, i) => sum + i.value, 0);
      cells.push({ canonicalKey: key, periodKey: period, value: display, formula: parts.join(" + "), inputs });
      raw.set(cellId(key, period), rawValue);
      shown.set(cellId(key, period), display);
      return rawValue;
    };

    const putHeldFlat = (key: string): number => {
      const value = open(key);
      return put(key, value, `${key}[${prior}] (held flat)`, [openInput(key)]);
    };

    // ================= 5.1 Income statement =================

    const revenue = put(
      "revenue",
      open("revenue") * (1 + d("revenue_growth")),
      `revenue[${prior}] * (1 + revenue_growth)`,
      [openInput("revenue"), dInput("revenue_growth")],
    );

    const costOfRevenue = put(
      "cost_of_revenue",
      -(revenue * (1 - d("gross_margin"))),
      "-(revenue * (1 - gross_margin))",
      [{ label: "Revenue", value: revenue }, dInput("gross_margin")],
    );

    const grossProfit = put("gross_profit", revenue + costOfRevenue, "revenue + cost_of_revenue", [
      { label: "Revenue", value: revenue },
      { label: itemLabel("cost_of_revenue"), value: costOfRevenue },
    ]);

    put("research_development", -(revenue * d("rd_pct_revenue")), "-(revenue * rd_pct_revenue)", [
      { label: "Revenue", value: revenue },
      dInput("rd_pct_revenue"),
    ]);

    put("selling_general_admin", -(revenue * d("sga_pct_revenue")), "-(revenue * sga_pct_revenue)", [
      { label: "Revenue", value: revenue },
      dInput("sga_pct_revenue"),
    ]);

    const operatingExpenses = putSubtotal("operating_expenses");

    const operatingIncome = put(
      "operating_income",
      grossProfit + operatingExpenses,
      "gross_profit + operating_expenses",
      [
        { label: itemLabel("gross_profit"), value: grossProfit },
        { label: itemLabel("operating_expenses"), value: operatingExpenses },
      ],
    );

    // Opening debt: short-term plus long-term plus whatever the revolver was carrying
    // in. Not the closing balance, so this period's own draw costs nothing this period.
    const openingDebt = open("short_term_debt") + open("long_term_debt") + open("revolver");
    const interestExpense = put(
      "interest_expense",
      -(openingDebt * d("interest_rate_debt")),
      `-((short_term_debt[${prior}] + long_term_debt[${prior}] + revolver[${prior}]) * interest_rate_debt)`,
      [
        openInput("short_term_debt"),
        openInput("long_term_debt"),
        openInput("revolver"),
        dInput("interest_rate_debt"),
      ],
    );

    const otherIncomeExpense = put(
      "other_income_expense",
      d("other_income_expense") + open("cash_and_equivalents") * d("interest_rate_cash"),
      `other_income_expense + cash_and_equivalents[${prior}] * interest_rate_cash`,
      [dInput("other_income_expense"), openInput("cash_and_equivalents"), dInput("interest_rate_cash")],
    );

    const pretaxIncome = put(
      "pretax_income",
      operatingIncome + interestExpense + otherIncomeExpense,
      "operating_income + interest_expense + other_income_expense",
      [
        { label: itemLabel("operating_income"), value: operatingIncome },
        { label: itemLabel("interest_expense"), value: interestExpense },
        { label: itemLabel("other_income_expense"), value: otherIncomeExpense },
      ],
    );

    // A loss year pays no tax and earns no credit: there is no loss carryforward here.
    const incomeTaxExpense = put(
      "income_tax_expense",
      -(Math.max(pretaxIncome, 0) * d("tax_rate")),
      "-(max(pretax_income, 0) * tax_rate)",
      [{ label: itemLabel("pretax_income"), value: pretaxIncome }, dInput("tax_rate")],
    );

    const netIncome = put(
      "net_income",
      pretaxIncome + incomeTaxExpense,
      "pretax_income + income_tax_expense",
      [
        { label: itemLabel("pretax_income"), value: pretaxIncome },
        { label: itemLabel("income_tax_expense"), value: incomeTaxExpense },
      ],
    );

    // ================= 5.2 Working capital and cash flow =================

    const accountsReceivable = put(
      "accounts_receivable",
      (d("dso") / DAYS_IN_YEAR) * revenue,
      "dso / 365 * revenue",
      [dInput("dso"), { label: "Revenue", value: revenue }],
    );

    const inventory = put(
      "inventory",
      (d("dio") / DAYS_IN_YEAR) * Math.abs(costOfRevenue),
      "dio / 365 * |cost_of_revenue|",
      [dInput("dio"), { label: itemLabel("cost_of_revenue"), value: costOfRevenue }],
    );

    const accountsPayable = put(
      "accounts_payable",
      (d("dpo") / DAYS_IN_YEAR) * Math.abs(costOfRevenue),
      "dpo / 365 * |cost_of_revenue|",
      [dInput("dpo"), { label: itemLabel("cost_of_revenue"), value: costOfRevenue }],
    );

    const deltaWorkingCapital =
      (accountsReceivable - open("accounts_receivable")) +
      (inventory - open("inventory")) -
      (accountsPayable - open("accounts_payable"));

    put(
      "change_in_working_capital",
      -deltaWorkingCapital,
      `-((accounts_receivable - accounts_receivable[${prior}]) + (inventory - inventory[${prior}]) - (accounts_payable - accounts_payable[${prior}]))`,
      [
        { label: itemLabel("accounts_receivable"), value: accountsReceivable },
        openInput("accounts_receivable"),
        { label: itemLabel("inventory"), value: inventory },
        openInput("inventory"),
        { label: itemLabel("accounts_payable"), value: accountsPayable },
        openInput("accounts_payable"),
      ],
    );

    // Opening PP&E, before this period's capex lands, so a heavy investment year does
    // not inflate its own depreciation charge.
    const depreciation = put(
      "depreciation_amortisation",
      open("property_plant_equipment") * d("depreciation_pct_ppe"),
      `property_plant_equipment[${prior}] * depreciation_pct_ppe`,
      [openInput("property_plant_equipment"), dInput("depreciation_pct_ppe")],
    );

    const stockBasedCompensation = put(
      "stock_based_compensation",
      revenue * d("sbc_pct_revenue"),
      "revenue * sbc_pct_revenue",
      [{ label: "Revenue", value: revenue }, dInput("sbc_pct_revenue")],
    );

    put("cf_net_income", netIncome, "net_income", [{ label: itemLabel("net_income"), value: netIncome }]);

    const cashFromOperations = putSubtotal("cash_from_operations");

    const capitalExpenditures = put(
      "capital_expenditures",
      -(revenue * d("capex_pct_revenue")),
      "-(revenue * capex_pct_revenue)",
      [{ label: "Revenue", value: revenue }, dInput("capex_pct_revenue")],
    );

    // Held at zero, from the constant, so removing a key from the constant removes the
    // cell rather than leaving a hardcoded `put` the constant no longer covers.
    for (const key of HELD_AT_ZERO_KEYS) {
      if (lineItem(key)?.parentKey !== "cash_from_investing") continue;
      put(key, 0, "0 (held at zero)", []);
    }
    const cashFromInvesting = putSubtotal("cash_from_investing");

    const debtIssuedRepaid = put(
      "debt_issued_repaid",
      -d("debt_repayment"),
      "-debt_repayment",
      [dInput("debt_repayment")],
    );

    const dividendsPaid = put(
      "dividends_paid",
      -(Math.max(netIncome, 0) * d("dividend_payout")),
      "-(max(net_income, 0) * dividend_payout)",
      [{ label: itemLabel("net_income"), value: netIncome }, dInput("dividend_payout")],
    );

    for (const key of HELD_AT_ZERO_KEYS) {
      if (lineItem(key)?.parentKey !== "cash_from_financing") continue;
      put(key, 0, "0 (held at zero)", []);
    }

    // ================= 5.3 The plug =================

    const openingCash = open("cash_and_equivalents");
    const openingRevolver = open("revolver");
    const minCash = d("min_cash");

    const preplugFinancing = debtIssuedRepaid + dividendsPaid;
    const preplugChange = cashFromOperations + cashFromInvesting + preplugFinancing;
    const cashBeforePlug = openingCash + preplugChange;

    let drawn = 0;
    let repaid = 0;
    let revolverBalance: number;
    let cash: number;
    if (cashBeforePlug < minCash) {
      drawn = minCash - cashBeforePlug;
      revolverBalance = openingRevolver + drawn;
      cash = minCash;
    } else {
      const surplus = cashBeforePlug - minCash;
      repaid = Math.min(surplus, openingRevolver);
      revolverBalance = openingRevolver - repaid;
      cash = cashBeforePlug - repaid;
    }
    const revolverMovement = revolverBalance - openingRevolver;

    plugs.push({ periodKey: period, cashBeforePlug, drawn, repaid, revolverBalance });

    // The plug's cash effect gets its own cash-flow line, so `cash_from_financing` stays
    // the sum of its components like every other subtotal and nothing is hidden inside
    // it (spec section 2).
    put("revolver_movement", revolverMovement, "revolver - revolver[" + prior + "]", [
      { label: "Drawn", value: drawn },
      { label: "Repaid", value: repaid },
    ]);

    const cashFromFinancing = putSubtotal("cash_from_financing");

    put("fx_effect_on_cash", 0, "0 (no currency translation in a forecast)", []);

    const netChangeInCash = put(
      "net_change_in_cash",
      cashFromOperations + cashFromInvesting + cashFromFinancing,
      "cash_from_operations + cash_from_investing + cash_from_financing",
      [
        { label: itemLabel("cash_from_operations"), value: cashFromOperations },
        { label: itemLabel("cash_from_investing"), value: cashFromInvesting },
        { label: itemLabel("cash_from_financing"), value: cashFromFinancing },
      ],
    );

    // ================= 5.4 Balance sheet =================

    put("cash_and_equivalents", cash, `cash_and_equivalents[${prior}] + net_change_in_cash`, [
      openInput("cash_and_equivalents"),
      { label: itemLabel("net_change_in_cash"), value: netChangeInCash },
    ]);
    putHeldFlat("short_term_investments");
    putHeldFlat("other_current_assets");
    putSubtotal("total_current_assets");

    put(
      "property_plant_equipment",
      open("property_plant_equipment") + Math.abs(capitalExpenditures) - depreciation,
      `property_plant_equipment[${prior}] + |capital_expenditures| - depreciation_amortisation`,
      [
        openInput("property_plant_equipment"),
        { label: itemLabel("capital_expenditures"), value: capitalExpenditures },
        { label: itemLabel("depreciation_amortisation"), value: depreciation },
      ],
    );
    putHeldFlat("goodwill");
    putHeldFlat("intangible_assets");
    putHeldFlat("other_noncurrent_assets");

    const totalAssetsInputs = TOTAL_ASSETS_PARTS.map((k) => ({
      label: itemLabel(k),
      value: raw.get(cellId(k, period)) ?? 0,
    }));
    const totalAssets = put(
      "total_assets",
      totalAssetsInputs.reduce((s, i) => s + i.value, 0),
      TOTAL_ASSETS_PARTS.join(" + "),
      totalAssetsInputs,
    );

    putHeldFlat("accrued_liabilities");
    putHeldFlat("deferred_revenue_current");
    putHeldFlat("short_term_debt");
    put("revolver", revolverBalance, `revolver[${prior}] + drawn - repaid`, [
      openInput("revolver"),
      { label: "Drawn", value: drawn },
      { label: "Repaid", value: repaid },
    ]);
    putHeldFlat("other_current_liabilities");
    putSubtotal("total_current_liabilities");

    put(
      "long_term_debt",
      Math.max(open("long_term_debt") - d("debt_repayment"), 0),
      `max(long_term_debt[${prior}] - debt_repayment, 0)`,
      [openInput("long_term_debt"), dInput("debt_repayment")],
    );
    putHeldFlat("other_noncurrent_liabilities");

    const totalLiabilitiesInputs = TOTAL_LIABILITIES_PARTS.map((k) => ({
      label: itemLabel(k),
      value: raw.get(cellId(k, period)) ?? 0,
    }));
    const totalLiabilities = put(
      "total_liabilities",
      totalLiabilitiesInputs.reduce((s, i) => s + i.value, 0),
      TOTAL_LIABILITIES_PARTS.join(" + "),
      totalLiabilitiesInputs,
    );

    put(
      "common_stock_apic",
      open("common_stock_apic") + stockBasedCompensation,
      `common_stock_apic[${prior}] + stock_based_compensation`,
      [openInput("common_stock_apic"), { label: itemLabel("stock_based_compensation"), value: stockBasedCompensation }],
    );
    put(
      "retained_earnings",
      open("retained_earnings") + netIncome + dividendsPaid,
      `retained_earnings[${prior}] + net_income + dividends_paid`,
      [
        openInput("retained_earnings"),
        { label: itemLabel("net_income"), value: netIncome },
        { label: itemLabel("dividends_paid"), value: dividendsPaid },
      ],
    );
    putHeldFlat("treasury_stock");
    putHeldFlat("accumulated_oci");
    const totalEquity = putSubtotal("total_equity");

    // ================= 5.5 The articulation invariant =================
    if (!articulates(totalAssets, totalLiabilities + totalEquity)) {
      findings.push({
        code: "forecast_articulation_broken",
        severity: "blocking",
        periodKey: period,
        keys: ["total_assets", "total_liabilities", "total_equity"],
        message: `${period} does not balance: assets ${totalAssets} against liabilities and equity ${totalLiabilities + totalEquity}.`,
        remediation: "This is a defect in the forecast engine, not in the assumptions. Report it with the workspace and the scenario.",
      });
    }
    if (!articulates(openingCash + netChangeInCash, cash)) {
      findings.push({
        code: "forecast_articulation_broken",
        severity: "blocking",
        periodKey: period,
        keys: ["cash_and_equivalents", "net_change_in_cash"],
        message: `${period} cash does not tie: opening ${openingCash} plus the net change ${netChangeInCash} is not the closing balance ${cash}.`,
        remediation: "This is a defect in the forecast engine, not in the assumptions. Report it with the workspace and the scenario.",
      });
    }

    priorPeriod = period;
  }

  // A forecast cell is never NaN or Infinity. If one is, the arithmetic above went
  // somewhere no named finding covers, which is an engine bug of the same class as a
  // broken balance sheet, and is refused the same way.
  const nonFinite = cells.filter((c) => !Number.isFinite(c.value));
  if (nonFinite.length > 0) {
    findings.push({
      code: "forecast_articulation_broken",
      severity: "blocking",
      periodKey: nonFinite[0].periodKey,
      keys: [...new Set(nonFinite.map((c) => c.canonicalKey))],
      message: `${nonFinite.length} forecast ${nonFinite.length === 1 ? "cell is" : "cells are"} not a finite number.`,
      remediation: "This is a defect in the forecast engine, not in the assumptions. Report it with the workspace and the scenario.",
    });
  }

  // ---- Warnings (spec 5.6) ----------------------------------------------------
  const drewPeriods = plugs.filter((p) => p.drawn > 0).map((p) => p.periodKey);
  if (drewPeriods.length > 0) {
    findings.push({
      code: "forecast_revolver_drawn",
      severity: "warning",
      periodKey: drewPeriods[0],
      keys: ["revolver"],
      message: `The revolver is drawn to hold cash at the minimum in ${drewPeriods.join(", ")}.`,
      remediation: "The forecast funds itself with borrowing in those years. Check the minimum-cash floor and the spending assumptions if that is not intended.",
    });
  }

  const negativeEquity = input.forecastPeriods.filter((p) => (raw.get(cellId("total_equity", p)) ?? 0) < 0);
  if (negativeEquity.length > 0) {
    findings.push({
      code: "forecast_equity_negative",
      severity: "warning",
      periodKey: negativeEquity[0],
      keys: ["total_equity"],
      message: `Total equity falls below zero in ${negativeEquity.join(", ")}.`,
      remediation: "Accumulated losses or distributions exceed contributed capital. Check the margin, dividend and growth assumptions.",
    });
  }

  if (findings.some((f) => f.severity === "blocking")) return blocked();

  return {
    ok: true,
    cells,
    plugs,
    findings,
    valueAt: (key: string, period: string) => shown.get(cellId(key, period)),
  };
}

export { HELD_AT_ZERO_KEYS, HELD_FLAT_KEYS, REQUIRED_OPENING_KEYS, SIGN_OBSERVED_KEYS };
