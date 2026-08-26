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
  "finding.forecast_not_annual":
    "The forecast engine extends the latest historical year forward. A workspace whose most recent period is a quarter has no year to extend, so it cannot be forecast.",
  "finding.forecast_missing_base":
    "A line item the engine needs an opening balance for has no value in the last historical period, so the forecast has nothing to roll forward from.",
  "finding.forecast_articulation_broken":
    "The balance sheet did not close: assets did not equal liabilities plus equity in a forecast period. This is an engine bug, not a pessimistic forecast.",
  "finding.forecast_revolver_drawn":
    "Cash fell below the minimum-cash floor in at least one forecast period, so the revolver was drawn to cover the shortfall.",
  "finding.forecast_equity_negative":
    "Total equity fell below zero in a forecast period. Ratios that divide by equity, such as return on equity, become undefined or misleading.",
  "finding.forecast_driver_default":
    "At least one driver could not be derived from history and fell back to a documented default rather than the business's own historical figure.",
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
  "control.ratio_focus",
  "control.ratio_averaging",
  "control.ratio_new",
  "control.scenario_tab",
  "control.scenario_add",
  "control.scenario_rename",
  "control.scenario_duplicate",
  "control.scenario_delete",
  "control.scenario_horizon",
  "control.driver_seed_marker",
  "control.driver_fill_right",
  "control.forecast_cell",
  "control.held_flat_row",
  "control.held_at_zero_row",
  "control.sensitivity_base_cell",
  "control.sensitivity_shading",
] as const;

const controlTooltips: Record<(typeof CONTROL_KEYS)[number], string> = {
  "control.upload": "Drop a 10-K, 10-Q, case PDF, Excel workbook (.xlsx, .xlsm) or CSV here, or click to pick a file. Limit 30 MB.",
  "control.reset_cell": "Discard your edit and restore the value as extracted from the source document.",
  "control.remap": "Move this line to a different canonical item. Use this when the extractor put a figure in the wrong bucket.",
  "control.provenance": "Show where this figure came from: source page, the label and value as printed, and the scale applied.",
  "control.dismiss_banner": "Hide this message for the rest of this session. Nothing about the figures changes, and it comes back if you reload the page while the problem is still there.",
  "control.confidence_badge": "How confident the extractor was in this figure and its mapping. Below 60% is flagged for review.",
  "control.ratio_explain": "Ask for a short read of what these numbers did across the periods. It is generated from the computed values only, never from the source document, and it is kept until one of those values changes.",
  "control.ratio_focus": "Narrow the list to the twelve ratios a case study almost always wants, or show all twenty-five. This changes what is displayed, never how anything is computed.",
  "control.ratio_averaging": "How balance-sheet figures are read where a ratio divides a flow by a stock, such as return on equity. Average takes the mean of the opening and closing balance where a prior period exists; ending uses the closing balance. Ratios measured entirely on one date, like the current ratio, are unaffected either way.",
  "control.ratio_new": "Build your own ratio from line items and the four operators. It computes under exactly the same rules as the built-in library.",
  "control.ratio_expression": "Line items, numbers, brackets and the four operators. A line item is written by its key, and a ratio you have already saved can be used the same way. No functions, and nothing is executed as code.",
  "control.ratio_chip": "Press a line item to add it to the expression, or drag it into the box. Both do the same thing, so this works without a mouse.",
  "control.ratio_inputs": "Show the figures this ratio was built from: what each component held, what the ratio actually used after any sign or averaging adjustment, and a link back to where each figure came from.",
  "control.scenario_tab": "Switch to this scenario. Its own driver values, forecast statements and sensitivity grid replace the ones shown now.",
  "control.scenario_add": "Create a new scenario with drivers derived fresh from this workspace's history. You can change any value afterwards.",
  "control.scenario_rename": "Rename this scenario. The driver values and forecast underneath are unchanged.",
  "control.scenario_duplicate": "Copy this scenario's name and every one of its driver values into a new scenario.",
  "control.scenario_delete": "Delete this scenario and its driver values. The base scenario cannot be deleted, which is why it has no delete control.",
  "control.scenario_horizon": "How many forecast periods to project, from one to five years. Raising it seeds new periods from the last one; lowering it deletes the periods beyond the new horizon.",
  "control.driver_seed_marker": "This driver is still at the value it was seeded with. The tooltip on the marker itself says whether that value was derived from history or is a fallback default.",
  "control.driver_fill_right": "Copy this period's value across every later forecast period for this driver, so the same assumption does not have to be typed five times.",
  "control.forecast_cell": "Show the formula that produced this figure, the driver values it used, and the opening balances it read. Forecast cells are computed, not edited: change the driver instead.",
  "control.held_flat_row": "This line is held flat at its opening balance for every forecast period, because the model has no driver that moves it.",
  "control.held_at_zero_row": "This line is held at zero for every forecast period. Repeating a one-off figure indefinitely would be a worse default than assuming none.",
  "control.sensitivity_base_cell": "The cell matching this scenario's current driver values, outlined so it is easy to find among the grid.",
  "control.sensitivity_shading": "Cells are shaded by how far the output sits from the base case. The direction arrow and shade intensity both carry that reading, so the grid does not depend on colour alone.",
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
