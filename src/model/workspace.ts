import { itemsFor, type LineItemDef, type StatementKind } from "./taxonomy";
import { validate, type Finding, type ValueLookup } from "./validate";
import { sortPeriodsMostRecentFirst } from "./periods";
import type { Provenance } from "@/db/schema";

export interface ExtractedFactLike {
  canonicalKey: string;
  periodKey: string;
  value: number;
  confidence: number;
  provenance: Provenance;
}

export interface OverrideLike {
  canonicalKey: string;
  periodKey: string;
  value: number;
}

export interface Cell {
  canonicalKey: string;
  periodKey: string;
  value: number | undefined;
  source: "extracted" | "override" | "absent" | "forecast";
  extractedValue: number | undefined;
  confidence: number | undefined;
  provenance: Provenance | undefined;
}

export interface StatementRow {
  def: LineItemDef;
  cells: Cell[];
}

/**
 * A forecast layer widens the workspace with computed periods, rather than forking a
 * second view: `computeRatios` reads only a `WorkspaceView`, so this is the one seam
 * through which ratios can ever cover forecast periods (spec §7).
 */
export interface WorkspaceForecastLayer {
  periods: string[];
  valueAt: ValueLookup;
}

export interface WorkspaceInput {
  periods: string[];
  facts: ExtractedFactLike[];
  overrides: OverrideLike[];
  scaleFactors?: number[];
  conflicts?: { canonicalKey: string; periodKey: string }[];
  forecast?: WorkspaceForecastLayer;
}

export interface WorkspaceView {
  periods: string[];
  cell(canonicalKey: string, periodKey: string): Cell;
  statement(kind: StatementKind): StatementRow[];
  findings: Finding[];
}

const id = (key: string, period: string) => `${key}::${period}`;

export function buildWorkspace(input: WorkspaceInput): WorkspaceView {
  const factIndex = new Map(input.facts.map((f) => [id(f.canonicalKey, f.periodKey), f]));
  const overrideIndex = new Map(input.overrides.map((o) => [id(o.canonicalKey, o.periodKey), o]));
  const forecast = input.forecast;
  const forecastPeriodSet = new Set(forecast?.periods ?? []);

  // Most recent first, forecast keys included, through the one ordering rule the rest
  // of the codebase already relies on — never a concatenation of the two lists. A
  // `Set` union, not a concatenation, also protects against a key present in both
  // lists producing two identical columns; that should never happen (forecast periods
  // are always strictly beyond the historical horizon), but a caller bug here should
  // collapse to one column rather than silently double a period in the view.
  const periods = forecastPeriodSet.size > 0
    ? sortPeriodsMostRecentFirst([...new Set([...input.periods, ...forecastPeriodSet])])
    : input.periods;

  function cell(canonicalKey: string, periodKey: string): Cell {
    // A forecast period resolves from the layer only, before facts or overrides are
    // even consulted. Forecast cells are not overridable — that is the invariant the
    // rest of the milestone rests on — so an override can never reach this branch.
    if (forecast && forecastPeriodSet.has(periodKey)) {
      return {
        canonicalKey,
        periodKey,
        value: forecast.valueAt(canonicalKey, periodKey),
        source: "forecast",
        extractedValue: undefined,
        confidence: undefined,
        provenance: undefined,
      };
    }

    const fact = factIndex.get(id(canonicalKey, periodKey));
    const override = overrideIndex.get(id(canonicalKey, periodKey));
    const base: Omit<Cell, "value" | "source"> = {
      canonicalKey,
      periodKey,
      extractedValue: fact?.value,
      confidence: fact?.confidence,
      provenance: fact?.provenance,
    };
    if (override) return { ...base, value: override.value, source: "override" };
    if (fact) return { ...base, value: fact.value, source: "extracted" };
    return { ...base, value: undefined, source: "absent" };
  }

  const valueAt = (key: string, period: string) => cell(key, period).value;
  const confidenceAt = (key: string, period: string) => {
    const c = cell(key, period);
    // A figure the user has typed themselves is not low-confidence, and a forecast
    // cell's confidence is undefined already.
    return c.source === "override" ? undefined : c.confidence;
  };

  return {
    periods,
    cell,
    statement(kind) {
      return itemsFor(kind).map((def) => ({
        def,
        cells: periods.map((p) => cell(def.key, p)),
      }));
    },
    // Deliberately scoped to the historical period list, not `periods`: M1's
    // balance-sheet, cash-flow and subtotal checks assume an extracted, closable
    // statement, which a forecast column is not. Forecast periods get their own
    // findings from the forecast engine (the `forecast_*` codes above), never M1's.
    findings: validate({
      periods: input.periods,
      valueAt,
      confidenceAt,
      scaleFactors: input.scaleFactors,
      conflicts: input.conflicts,
    }),
  };
}
