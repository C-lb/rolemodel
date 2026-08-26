import { TAXONOMY, lineItem, type StatementKind } from "./taxonomy";
import { closeEnough } from "./tolerance";
import { isImmediatePredecessor, isRankablePeriodKey, missingPeriodsInSequence } from "./periods";

export type FindingSeverity = "blocking" | "warning";

export const FINDING_CODES = [
  "balance_sheet_imbalance", "cashflow_tie_out", "subtotal_mismatch", "missing_periods",
  "missing_statement", "low_confidence", "scale_inconsistent", "merge_conflict",
] as const;
export type FindingCode = (typeof FINDING_CODES)[number];

export interface Finding {
  code: FindingCode;
  severity: FindingSeverity;
  periodKey: string | null;
  message: string;
  remediation: string;
  keys: string[];
}

export type ValueLookup = (canonicalKey: string, periodKey: string) => number | undefined;

export interface ValidateInput {
  periods: string[];
  valueAt: ValueLookup;
  confidenceAt?: (canonicalKey: string, periodKey: string) => number | undefined;
  scaleFactors?: number[];
  conflicts?: { canonicalKey: string; periodKey: string }[];
}

const LOW_CONFIDENCE = 0.6;
const CF_COMPONENTS = ["cash_from_operations", "cash_from_investing", "cash_from_financing", "fx_effect_on_cash"];

function money(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function statementHasData(statement: StatementKind, periods: string[], valueAt: ValueLookup): boolean {
  return TAXONOMY.some(
    (item) => item.statement === statement && periods.some((p) => valueAt(item.key, p) !== undefined),
  );
}

export function validate(input: ValidateInput): Finding[] {
  const { periods, valueAt } = input;
  const findings: Finding[] = [];

  if (periods.length === 0) {
    return [{
      code: "missing_periods", severity: "blocking", periodKey: null, keys: [],
      message: "No reporting periods were found in this document.",
      remediation: "Check that the upload contains financial statements, then re-run extraction.",
    }];
  }

  // Check 4: period coverage is complete and consistently ordered. Every other
  // per-period check reads `periods` as "most recent first", which only holds for
  // keys this model can rank — so an unrankable key is reported before anything
  // downstream is allowed to draw a conclusion from the ordering.
  const unrankable = periods.filter((p) => !isRankablePeriodKey(p));
  if (unrankable.length > 0) {
    findings.push({
      code: "missing_periods", severity: "blocking", periodKey: null, keys: unrankable,
      message: `${unrankable.length === 1 ? "Period" : "Periods"} ${unrankable.map((p) => `"${p}"`).join(", ")} could not be recognised, so the periods could not be put in order.`,
      remediation: "Period labels must read FY2024 or Q2-2025. Re-run extraction; if the labels in the document are unusual, re-run over just the statement pages so the headers are unambiguous.",
    });
  }

  const gaps = missingPeriodsInSequence(periods);
  if (gaps.length > 0) {
    findings.push({
      code: "missing_periods", severity: "warning", periodKey: null, keys: gaps,
      message: `The extracted periods skip ${gaps.join(", ")}.`,
      remediation: "If the document reports that period, re-run extraction over its columns. Comparisons between periods either side of a gap are not made.",
    });
  }

  for (const statement of ["income", "balance", "cashflow"] as StatementKind[]) {
    if (!statementHasData(statement, periods, valueAt)) {
      findings.push({
        // `keys` names the statement rather than a line item here: it is what makes
        // one missing-statement finding distinguishable from its two siblings.
        code: "missing_statement", severity: "warning", periodKey: null, keys: [statement],
        message: `No ${statement} statement figures were extracted.`,
        remediation: "If the statement is in the document, re-run extraction over its page range. Otherwise upload the missing statement separately.",
      });
    }
  }

  // Ordered most recent first, so the prior period is the next entry.
  for (const [i, period] of periods.entries()) {
    const assets = valueAt("total_assets", period);
    const liabilities = valueAt("total_liabilities", period);
    const equity = valueAt("total_equity", period);

    if (assets !== undefined && liabilities !== undefined && equity !== undefined) {
      if (!closeEnough(assets, liabilities + equity)) {
        const gap = assets - (liabilities + equity);
        findings.push({
          code: "balance_sheet_imbalance", severity: "blocking", periodKey: period,
          keys: ["total_assets", "total_liabilities", "total_equity"],
          message: `${period}: assets of ${money(assets)} do not equal liabilities plus equity of ${money(liabilities + equity)}. Gap ${money(gap)}.`,
          remediation: "Open the balance sheet for this period and check the three totals against the source pages. A gap equal to a single line item usually means that item was missed or double-counted.",
        });
      }
    }

    const components = CF_COMPONENTS.map((k) => valueAt(k, period)).filter((v): v is number => v !== undefined);
    const netChange = valueAt("net_change_in_cash", period);
    if (netChange !== undefined && components.length >= 3) {
      const sum = components.reduce((a, b) => a + b, 0);
      if (!closeEnough(sum, netChange)) {
        findings.push({
          code: "cashflow_tie_out", severity: "blocking", periodKey: period,
          keys: [...CF_COMPONENTS, "net_change_in_cash"],
          message: `${period}: operating, investing and financing cash flows sum to ${money(sum)} but net change in cash is ${money(netChange)}.`,
          remediation: "Check the three section subtotals and the FX line against the source. A sign error on one section is the usual cause.",
        });
      }
    }

    // The next entry is only the prior period when both keys can be ranked AND they
    // are genuinely adjacent. Unrankable keys collapse the sort to insertion order,
    // and a gap in the sequence makes the movement between the two entries mean
    // nothing — either way, comparing them would report a discrepancy that is not there.
    const next = periods[i + 1];
    const priorPeriod = next !== undefined && isImmediatePredecessor(period, next) ? next : undefined;
    const cashNow = valueAt("cash_and_equivalents", period);
    const cashPrior = priorPeriod ? valueAt("cash_and_equivalents", priorPeriod) : undefined;
    if (netChange !== undefined && cashNow !== undefined && cashPrior !== undefined) {
      if (!closeEnough(cashNow - cashPrior, netChange)) {
        findings.push({
          code: "cashflow_tie_out", severity: "blocking", periodKey: period,
          keys: ["cash_and_equivalents", "net_change_in_cash"],
          message: `${period}: balance-sheet cash moved by ${money(cashNow - cashPrior)} but the cash-flow statement reports a net change of ${money(netChange)}.`,
          remediation: "Confirm the balance-sheet cash line excludes short-term investments, and that both periods use the same scale.",
        });
      }
    }

    for (const subtotal of TAXONOMY.filter((i) => i.isSubtotal)) {
      const children = TAXONOMY.filter((i) => i.parentKey === subtotal.key);
      if (children.length === 0) continue;
      const values = children.map((c) => valueAt(c.key, period));
      // Skip when nothing was extracted for the breakdown at all — a subtotal
      // reported with none of its components present is a missing breakdown,
      // not a mismatch. But if at least one component was extracted, compare
      // it against what was reported: a partially extracted breakdown that
      // already disagrees with its total is worth surfacing.
      const definedValues = values.filter((v): v is number => v !== undefined);
      if (definedValues.length === 0) continue;
      const sum = definedValues.reduce((a, b) => a + b, 0);
      const reported = valueAt(subtotal.key, period);
      if (reported === undefined || closeEnough(sum, reported)) continue;
      findings.push({
        code: "subtotal_mismatch", severity: "warning", periodKey: period,
        keys: [subtotal.key, ...children.map((c) => c.key)],
        message: `${period}: ${subtotal.label} is reported as ${money(reported)} but its components sum to ${money(sum)}.`,
        remediation: "This is often correct — the source may include a line the taxonomy does not model. Check the source page, and add the missing amount to the closest 'other' line if so.",
      });
    }

    if (input.confidenceAt) {
      const lowKeys = TAXONOMY
        .filter((item) => {
          const c = input.confidenceAt!(item.key, period);
          return c !== undefined && c < LOW_CONFIDENCE;
        })
        .map((item) => item.key);
      if (lowKeys.length > 0) {
        findings.push({
          code: "low_confidence", severity: "warning", periodKey: period, keys: lowKeys,
          message: `${period}: ${lowKeys.length} figure${lowKeys.length === 1 ? " was" : "s were"} extracted with low confidence.`,
          remediation: "Open each flagged figure's provenance panel and compare it against the source page before relying on it.",
        });
      }
    }
  }

  const scales = [...new Set(input.scaleFactors ?? [])];
  if (scales.length > 1) {
    findings.push({
      code: "scale_inconsistent", severity: "blocking", periodKey: null, keys: [],
      message: `Figures in this document were scaled by more than one factor (${scales.map(money).join(", ")}).`,
      remediation: "Statements presented in different units are a common source of silent errors. Check each statement's header and correct the affected figures.",
    });
  }

  for (const conflict of input.conflicts ?? []) {
    const label = lineItem(conflict.canonicalKey)?.label ?? conflict.canonicalKey;
    findings.push({
      code: "merge_conflict", severity: "blocking", periodKey: conflict.periodKey,
      keys: [conflict.canonicalKey],
      message: `${conflict.periodKey}: ${label} was extracted with more than one value.`,
      remediation: "Compare the candidates against the source pages and keep the correct one. The higher-confidence value is currently active.",
    });
  }

  return findings;
}
