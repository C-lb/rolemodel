export type StatementKind = "income" | "balance" | "cashflow";

export interface LineItemDef {
  key: string;
  statement: StatementKind;
  label: string;
  definition: string;
  order: number;
  parentKey: string | null;
  isSubtotal: boolean;
  /**
   * True only for a key the extractor can never emit, because it names a forecast
   * construct rather than anything a historical document reports. The ratio engine
   * reads this to resolve a genuinely absent value as zero rather than "unavailable" —
   * see `resolveLineItem` in `ratios/compute.ts`. Deliberately on `LineItemDef` rather
   * than a standalone list: a bare list of keys would let a future line item that CAN
   * legitimately be absent-because-unextracted get appended to it, at which point a
   * missing figure would silently read as zero and the ratio would report `ok` with a
   * wrong number. Omitted (falsy) on every other key.
   */
  absentMeansZero?: boolean;
}

export const UNMAPPED_KEY = "unmapped";

export const TAXONOMY: readonly LineItemDef[] = [
  // ---- Income statement ----
  { key: "revenue", statement: "income", label: "Revenue", order: 100, parentKey: null, isSubtotal: false,
    definition: "Total sales of goods and services in the period, net of returns and allowances." },
  { key: "cost_of_revenue", statement: "income", label: "Cost of revenue", order: 110, parentKey: null, isSubtotal: false,
    definition: "Direct costs attributable to producing the goods or services sold." },
  { key: "gross_profit", statement: "income", label: "Gross profit", order: 120, parentKey: null, isSubtotal: true,
    definition: "Revenue less cost of revenue. The margin available to cover operating costs." },
  { key: "research_development", statement: "income", label: "Research and development", order: 130, parentKey: "operating_expenses", isSubtotal: false,
    definition: "Costs of developing new products or services, expensed as incurred under US GAAP." },
  { key: "selling_general_admin", statement: "income", label: "Selling, general and administrative", order: 140, parentKey: "operating_expenses", isSubtotal: false,
    definition: "Overhead not directly tied to production: sales, marketing, corporate functions." },
  { key: "operating_expenses", statement: "income", label: "Total operating expenses", order: 150, parentKey: null, isSubtotal: true,
    definition: "Sum of costs of running the business excluding cost of revenue." },
  { key: "operating_income", statement: "income", label: "Operating income", order: 160, parentKey: null, isSubtotal: true,
    definition: "Gross profit less operating expenses. Profit from core operations before financing and tax." },
  { key: "interest_expense", statement: "income", label: "Interest expense", order: 170, parentKey: null, isSubtotal: false,
    definition: "Cost of borrowed funds for the period." },
  { key: "other_income_expense", statement: "income", label: "Other income (expense)", order: 180, parentKey: null, isSubtotal: false,
    definition: "Non-operating gains and losses not classified elsewhere." },
  { key: "pretax_income", statement: "income", label: "Income before tax", order: 190, parentKey: null, isSubtotal: true,
    definition: "Operating income adjusted for financing and other non-operating items." },
  { key: "income_tax_expense", statement: "income", label: "Income tax expense", order: 200, parentKey: null, isSubtotal: false,
    definition: "Current and deferred tax charged against pre-tax income." },
  { key: "net_income", statement: "income", label: "Net income", order: 210, parentKey: null, isSubtotal: true,
    definition: "Bottom-line profit after all costs, financing and tax." },

  // ---- Balance sheet: assets ----
  { key: "cash_and_equivalents", statement: "balance", label: "Cash and cash equivalents", order: 300, parentKey: "total_current_assets", isSubtotal: false,
    definition: "Cash on hand plus highly liquid investments maturing within three months." },
  { key: "short_term_investments", statement: "balance", label: "Short-term investments", order: 310, parentKey: "total_current_assets", isSubtotal: false,
    definition: "Marketable securities expected to be converted to cash within a year." },
  { key: "accounts_receivable", statement: "balance", label: "Accounts receivable", order: 320, parentKey: "total_current_assets", isSubtotal: false,
    definition: "Amounts owed by customers for goods or services already delivered." },
  { key: "inventory", statement: "balance", label: "Inventory", order: 330, parentKey: "total_current_assets", isSubtotal: false,
    definition: "Raw materials, work in progress and finished goods held for sale." },
  { key: "other_current_assets", statement: "balance", label: "Other current assets", order: 340, parentKey: "total_current_assets", isSubtotal: false,
    definition: "Prepaid expenses and other assets expected to be realised within a year." },
  { key: "total_current_assets", statement: "balance", label: "Total current assets", order: 350, parentKey: null, isSubtotal: true,
    definition: "Assets expected to be converted to cash or consumed within one operating cycle." },
  { key: "property_plant_equipment", statement: "balance", label: "Property, plant and equipment, net", order: 360, parentKey: null, isSubtotal: false,
    definition: "Long-lived physical assets net of accumulated depreciation." },
  { key: "goodwill", statement: "balance", label: "Goodwill", order: 370, parentKey: null, isSubtotal: false,
    definition: "Excess of purchase price over fair value of net assets acquired." },
  { key: "intangible_assets", statement: "balance", label: "Intangible assets, net", order: 380, parentKey: null, isSubtotal: false,
    definition: "Identifiable non-physical assets such as patents and customer relationships, net of amortisation." },
  { key: "other_noncurrent_assets", statement: "balance", label: "Other non-current assets", order: 390, parentKey: null, isSubtotal: false,
    definition: "Long-term assets not classified elsewhere." },
  { key: "total_assets", statement: "balance", label: "Total assets", order: 400, parentKey: null, isSubtotal: true,
    definition: "Everything the company owns or controls. Must equal liabilities plus equity." },

  // ---- Balance sheet: liabilities and equity ----
  { key: "accounts_payable", statement: "balance", label: "Accounts payable", order: 410, parentKey: "total_current_liabilities", isSubtotal: false,
    definition: "Amounts owed to suppliers for goods or services already received." },
  { key: "accrued_liabilities", statement: "balance", label: "Accrued liabilities", order: 420, parentKey: "total_current_liabilities", isSubtotal: false,
    definition: "Expenses incurred but not yet invoiced or paid." },
  { key: "deferred_revenue_current", statement: "balance", label: "Deferred revenue, current", order: 430, parentKey: "total_current_liabilities", isSubtotal: false,
    definition: "Cash collected for goods or services not yet delivered, due within a year." },
  { key: "short_term_debt", statement: "balance", label: "Short-term debt", order: 440, parentKey: "total_current_liabilities", isSubtotal: false,
    definition: "Borrowings and current portion of long-term debt due within a year." },
  { key: "revolver", statement: "balance", label: "Revolver", order: 445, parentKey: "total_current_liabilities", isSubtotal: false,
    definition: "The forecast's funding plug: drawn to defend the minimum-cash floor and repaid from surplus cash. Always absent in extracted historicals, since no historical document reports a forward-looking plug.",
    absentMeansZero: true },
  { key: "other_current_liabilities", statement: "balance", label: "Other current liabilities", order: 450, parentKey: "total_current_liabilities", isSubtotal: false,
    definition: "Obligations due within a year not classified elsewhere." },
  { key: "total_current_liabilities", statement: "balance", label: "Total current liabilities", order: 460, parentKey: null, isSubtotal: true,
    definition: "Obligations due within one operating cycle." },
  { key: "long_term_debt", statement: "balance", label: "Long-term debt", order: 470, parentKey: null, isSubtotal: false,
    definition: "Borrowings due more than one year out, excluding the current portion." },
  { key: "other_noncurrent_liabilities", statement: "balance", label: "Other non-current liabilities", order: 480, parentKey: null, isSubtotal: false,
    definition: "Long-term obligations not classified elsewhere, such as deferred tax." },
  { key: "total_liabilities", statement: "balance", label: "Total liabilities", order: 490, parentKey: null, isSubtotal: true,
    definition: "Everything the company owes to parties other than its shareholders." },
  { key: "common_stock_apic", statement: "balance", label: "Common stock and additional paid-in capital", order: 500, parentKey: "total_equity", isSubtotal: false,
    definition: "Capital contributed by shareholders in excess of par value." },
  { key: "retained_earnings", statement: "balance", label: "Retained earnings", order: 510, parentKey: "total_equity", isSubtotal: false,
    definition: "Cumulative profits retained in the business rather than paid out as dividends." },
  { key: "treasury_stock", statement: "balance", label: "Treasury stock", order: 520, parentKey: "total_equity", isSubtotal: false,
    definition: "Cost of the company's own shares repurchased and held. A contra-equity account." },
  { key: "accumulated_oci", statement: "balance", label: "Accumulated other comprehensive income", order: 530, parentKey: "total_equity", isSubtotal: false,
    definition: "Unrealised gains and losses bypassing the income statement, such as FX translation." },
  { key: "total_equity", statement: "balance", label: "Total shareholders' equity", order: 540, parentKey: null, isSubtotal: true,
    definition: "Residual claim of shareholders: total assets less total liabilities." },

  // ---- Cash flow ----
  { key: "cf_net_income", statement: "cashflow", label: "Net income", order: 600, parentKey: "cash_from_operations", isSubtotal: false,
    definition: "Starting point of the indirect-method cash-flow statement." },
  { key: "depreciation_amortisation", statement: "cashflow", label: "Depreciation and amortisation", order: 610, parentKey: "cash_from_operations", isSubtotal: false,
    definition: "Non-cash charges added back to net income." },
  { key: "stock_based_compensation", statement: "cashflow", label: "Stock-based compensation", order: 620, parentKey: "cash_from_operations", isSubtotal: false,
    definition: "Non-cash equity compensation expense added back to net income." },
  { key: "change_in_working_capital", statement: "cashflow", label: "Changes in working capital", order: 630, parentKey: "cash_from_operations", isSubtotal: false,
    definition: "Net cash effect of movements in receivables, inventory, payables and accruals." },
  { key: "cash_from_operations", statement: "cashflow", label: "Net cash from operating activities", order: 640, parentKey: null, isSubtotal: true,
    definition: "Cash generated by the core business before investing and financing." },
  { key: "capital_expenditures", statement: "cashflow", label: "Capital expenditures", order: 650, parentKey: "cash_from_investing", isSubtotal: false,
    definition: "Cash spent acquiring property, plant and equipment. Normally negative." },
  { key: "acquisitions", statement: "cashflow", label: "Acquisitions, net of cash acquired", order: 660, parentKey: "cash_from_investing", isSubtotal: false,
    definition: "Cash paid for business combinations." },
  { key: "other_investing", statement: "cashflow", label: "Other investing activities", order: 670, parentKey: "cash_from_investing", isSubtotal: false,
    definition: "Investing cash flows not classified elsewhere, including securities purchases and sales." },
  { key: "cash_from_investing", statement: "cashflow", label: "Net cash from investing activities", order: 680, parentKey: null, isSubtotal: true,
    definition: "Cash used in or generated by asset purchases, disposals and investments." },
  { key: "debt_issued_repaid", statement: "cashflow", label: "Net debt issued (repaid)", order: 690, parentKey: "cash_from_financing", isSubtotal: false,
    definition: "Cash raised from borrowings less repayments of principal." },
  { key: "equity_issued_repurchased", statement: "cashflow", label: "Net equity issued (repurchased)", order: 700, parentKey: "cash_from_financing", isSubtotal: false,
    definition: "Cash from share issuance less cash spent on buybacks." },
  { key: "dividends_paid", statement: "cashflow", label: "Dividends paid", order: 710, parentKey: "cash_from_financing", isSubtotal: false,
    definition: "Cash distributions to shareholders. Normally negative." },
  { key: "other_financing", statement: "cashflow", label: "Other financing activities", order: 720, parentKey: "cash_from_financing", isSubtotal: false,
    definition: "Financing cash flows not classified elsewhere." },
  { key: "cash_from_financing", statement: "cashflow", label: "Net cash from financing activities", order: 730, parentKey: null, isSubtotal: true,
    definition: "Cash raised from or returned to capital providers." },
  { key: "fx_effect_on_cash", statement: "cashflow", label: "Effect of exchange rates on cash", order: 740, parentKey: null, isSubtotal: false,
    definition: "Translation effect of currency movements on foreign cash balances." },
  { key: "net_change_in_cash", statement: "cashflow", label: "Net change in cash", order: 750, parentKey: null, isSubtotal: true,
    definition: "Sum of operating, investing and financing cash flows plus FX effect. Must equal the period-over-period change in balance-sheet cash." },
] as const;

const BY_KEY = new Map(TAXONOMY.map((i) => [i.key, i]));

export function lineItem(key: string): LineItemDef | undefined {
  return BY_KEY.get(key);
}

export function itemsFor(statement: StatementKind): LineItemDef[] {
  return TAXONOMY.filter((i) => i.statement === statement).sort((a, b) => a.order - b.order);
}
