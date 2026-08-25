import { TAXONOMY } from "@/model/taxonomy";

const itemTooltips: Record<string, string> = Object.fromEntries(
  TAXONOMY.map((i) => [`item.${i.key}`, i.definition]),
);

const findingTooltips: Record<string, string> = {
  "finding.balance_sheet_imbalance":
    "Total assets must equal total liabilities plus shareholders' equity. When they don't, a line item was missed, double-counted, or scaled differently from the rest of the statement.",
  "finding.cashflow_tie_out":
    "Operating, investing and financing cash flows plus the FX effect must equal the net change in cash, and that net change must equal the movement in balance-sheet cash between periods.",
  "finding.subtotal_mismatch":
    "A printed subtotal disagrees with the sum of the components extracted under it. Often the source includes a line this taxonomy does not model, so check before correcting.",
  "finding.missing_periods":
    "No reporting periods were found. Either the document has no statements, or the period headers were not recognised.",
  "finding.missing_statement":
    "One of the three statements produced no figures. Ratios and forecasts that depend on it will be unavailable.",
  "finding.low_confidence":
    "The extractor reported low confidence on these figures. Check each against its source page before relying on it.",
  "finding.scale_inconsistent":
    "Figures in this document were scaled by more than one factor. Mixing thousands and millions is a common cause of silent, large errors.",
  "finding.merge_conflict":
    "The same line item and period were extracted twice with different values. The higher-confidence value is active until you choose.",
};

/** Single source of truth for which control keys must have a tooltip. Add a key here and to controlTooltips together. */
export const CONTROL_KEYS = [
  "control.upload",
  "control.reset_cell",
  "control.remap",
  "control.provenance",
  "control.rerun_extraction",
  "control.dismiss_banner",
  "control.confidence_badge",
  "control.scale_badge",
] as const;

const controlTooltips: Record<(typeof CONTROL_KEYS)[number], string> = {
  "control.upload": "Drop a 10-K, 10-Q, case PDF or Excel workbook here, or click to pick a file. Limit 30 MB.",
  "control.reset_cell": "Discard your edit and restore the value as extracted from the source document.",
  "control.remap": "Move this line to a different canonical item. Use this when the extractor put a figure in the wrong bucket.",
  "control.provenance": "Show where this figure came from: source page, the label and value as printed, and the scale applied.",
  "control.rerun_extraction": "Extract this document again. The current results are kept until the new run succeeds.",
  "control.dismiss_banner": "Hide this message. It will return if the underlying problem is still present after your next edit.",
  "control.confidence_badge": "How confident the extractor was in this figure and its mapping. Below 60% is flagged for review.",
  "control.scale_badge": "The multiplier applied to the printed figure to reach base currency units.",
};

export const TOOLTIPS: Record<string, string> = {
  ...itemTooltips,
  ...findingTooltips,
  ...controlTooltips,
};

export function tooltip(key: string): string {
  const text = TOOLTIPS[key];
  if (!text) throw new Error(`No tooltip registered for "${key}". Add it to src/ui/tooltips.ts.`);
  return text;
}
