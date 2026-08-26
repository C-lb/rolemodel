import { TAXONOMY, UNMAPPED_KEY } from "@/model/taxonomy";
import { RATIOS } from "@/model/ratios/library";

const itemTooltips: Record<string, string> = Object.fromEntries(
  TAXONOMY.map((i) => [`item.${i.key}`, i.definition]),
);

/**
 * A ratio's help text is its authored definition plus its standard caveat, sourced from
 * the library rather than retyped here: one wording, reviewed in one place.
 */
const ratioTooltips: Record<string, string> = Object.fromEntries(
  RATIOS.map((r) => [`ratio.${r.key}`, `${r.definition} ${r.caveat}`]),
);

const findingTooltips: Record<string, string> = {
  "finding.balance_sheet_imbalance":
    "Total assets must equal total liabilities plus shareholders' equity. When they don't, a line item was missed, double-counted, or scaled differently from the rest of the statement.",
  "finding.cashflow_tie_out":
    "Operating, investing and financing cash flows plus the FX effect must equal the net change in cash, and that net change must equal the movement in balance-sheet cash between periods.",
  "finding.subtotal_mismatch":
    "A printed subtotal disagrees with the sum of the components extracted under it. Often the source includes a line this taxonomy does not model, so check before correcting.",
  "finding.missing_periods":
    "Something is wrong with the set of reporting periods: none were found, one of the labels could not be read, or the sequence skips a period. Checks that compare one period against another are only made where the order is certain.",
  "finding.missing_statement":
    "One of the three statements produced no figures. Ratios and forecasts that depend on it will be unavailable.",
  "finding.low_confidence":
    "The extractor reported low confidence on these figures. Check each against its source page before relying on it.",
  "finding.scale_inconsistent":
    "Figures in this document were scaled by more than one factor. Mixing thousands and millions is a common cause of silent, large errors.",
  "finding.merge_conflict":
    "The same line item and period were extracted twice with different values. The higher-confidence value is active until you choose.",
};

/**
 * Single source of truth for which control keys must have a tooltip. Add a key here
 * and to controlTooltips together. A key with no call site in src/ is a test failure:
 * copy for a control that does not exist is copy nobody can check against the product.
 */
export const CONTROL_KEYS = [
  "control.upload",
  "control.reset_cell",
  "control.remap",
  "control.provenance",
  "control.dismiss_banner",
  "control.confidence_badge",
  "control.ratio_explain",
  "control.ratio_inputs",
  "control.ratio_expression",
  "control.ratio_chip",
] as const;

const controlTooltips: Record<(typeof CONTROL_KEYS)[number], string> = {
  "control.upload": "Drop a 10-K, 10-Q, case PDF, Excel workbook (.xlsx, .xlsm) or CSV here, or click to pick a file. Limit 30 MB.",
  "control.reset_cell": "Discard your edit and restore the value as extracted from the source document.",
  "control.remap": "Move this line to a different canonical item. Use this when the extractor put a figure in the wrong bucket.",
  "control.provenance": "Show where this figure came from: source page, the label and value as printed, and the scale applied.",
  "control.dismiss_banner": "Hide this message for the rest of this session. Nothing about the figures changes, and it comes back if you reload the page while the problem is still there.",
  "control.confidence_badge": "How confident the extractor was in this figure and its mapping. Below 60% is flagged for review.",
  "control.ratio_explain": "Ask for a short read of what these numbers did across the periods. It is generated from the computed values only, never from the source document, and it is kept until one of those values changes.",
  "control.ratio_expression": "Line items, numbers, brackets and the four operators. A line item is written by its key, and a ratio you have already saved can be used the same way. No functions, and nothing is executed as code.",
  "control.ratio_chip": "Press a line item to add it to the expression, or drag it into the box. Both do the same thing, so this works without a mouse.",
  "control.ratio_inputs": "Show the figures this ratio was built from: what each component held, what the ratio actually used after any sign or averaging adjustment, and a link back to where each figure came from.",
};

/** Copy for figures that landed outside the taxonomy, which have no line-item definition to show. */
const unmappedTooltip: Record<string, string> = {
  [`item.${UNMAPPED_KEY}`]:
    "This figure is not mapped to a canonical line item, so nothing downstream will use it. Remap it to the line it belongs to.",
};

export const TOOLTIPS: Record<string, string> = {
  ...itemTooltips,
  ...ratioTooltips,
  ...unmappedTooltip,
  ...findingTooltips,
  ...controlTooltips,
};

export function tooltip(key: string): string {
  const text = TOOLTIPS[key];
  if (!text) throw new Error(`No tooltip registered for "${key}". Add it to src/ui/tooltips.ts.`);
  return text;
}
