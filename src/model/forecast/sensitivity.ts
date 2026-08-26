import type { Provenance } from "@/db/schema";
import { TAXONOMY } from "../taxonomy";
import { buildWorkspace, type ExtractedFactLike, type WorkspaceInput } from "../workspace";
import { computeRatios, type CustomRatioInput } from "../ratios/compute";
import type { AveragingMode } from "../ratios/types";
import { runForecast, type ForecastInput } from "./engine";

/**
 * The two-variable sensitivity grid, spec section 8. Re-runs `runForecast` once per
 * cell — up to 49 times, a `steps: 3 | 5 | 7` axis on each side rather than a runtime
 * clamp — with the two axis drivers wired to that cell's values across every forecast
 * period, and reads a single output metric back out.
 *
 * A ratio output has no second entry point: the cell's `ForecastResult.valueAt` is
 * wired into `buildWorkspace`'s forecast layer (Task 2) and read through the same
 * `computeRatios` the Ratios tab uses, so a sensitivity ratio and a ratios-tab ratio can
 * never disagree about what a ratio over a forecast period means.
 */

export type SensitivityOutput = {
  kind: "lineItem" | "ratio";
  key: string;
  periodKey: string;
};

export interface Axis {
  driverKey: string;
  min: number;
  max: number;
  steps: 3 | 5 | 7;
}

export type SensitivityCell =
  | { state: "ok"; value: number; isBase: boolean }
  | { state: "failed"; reason: string; isBase: boolean };

export interface SensitivityResult {
  rows: number[];
  columns: number[];
  cells: SensitivityCell[][];
}

/** A stand-in provenance for a fact synthesised from `ForecastInput.valueAt`, never extracted. */
const SYNTHETIC_PROVENANCE: Provenance = {
  page: null,
  sheet: null,
  locator: "sensitivity",
  rawLabel: "sensitivity",
  rawValue: "sensitivity",
  scaleFactor: 1,
  scaleEvidence: "sensitivity",
  signFlipped: false,
};

/**
 * Evenly spaced from `min` to `max`, inclusive of both endpoints. The last point is
 * `max` itself rather than a computed `min + step * (steps - 1)`, so a `steps: 3` axis
 * from 0 to 0.1 lands on exactly `0.1` rather than whatever `0 + 0.05 * 2` rounds to.
 */
function axisValues(axis: Axis): number[] {
  const { min, max, steps } = axis;
  const step = (max - min) / (steps - 1);
  return Array.from({ length: steps }, (_, i) => (i === steps - 1 ? max : min + step * i));
}

/**
 * Wraps `input.driverAt` so the two axis drivers read the cell's values in every
 * forecast period, and every other driver — and every historical-period read — passes
 * straight through. Never mutates `input` or any lookup it already owns.
 */
function withAxisDrivers(
  input: ForecastInput,
  rowAxis: Axis,
  rowValue: number,
  columnAxis: Axis,
  columnValue: number,
): ForecastInput {
  const forecastPeriods = new Set(input.forecastPeriods);
  const driverAt = (key: string, period: string): number | undefined => {
    if (forecastPeriods.has(period)) {
      if (key === rowAxis.driverKey) return rowValue;
      if (key === columnAxis.driverKey) return columnValue;
    }
    return input.driverAt(key, period);
  };
  return { ...input, driverAt };
}

/**
 * Every historical fact `computeRatios` might need for the output period's ratio,
 * synthesised once from `ForecastInput.valueAt` rather than per cell: the axis drivers
 * change the forecast, never the history, so this is the same for all 49 cells.
 */
function historicalFacts(input: ForecastInput): ExtractedFactLike[] {
  const facts: ExtractedFactLike[] = [];
  for (const period of input.historicalPeriods) {
    for (const def of TAXONOMY) {
      const value = input.valueAt(def.key, period);
      if (value !== undefined && Number.isFinite(value)) {
        facts.push({
          canonicalKey: def.key,
          periodKey: period,
          value,
          confidence: 1,
          provenance: SYNTHETIC_PROVENANCE,
        });
      }
    }
  }
  return facts;
}

/** The blocking finding's code, or a generic reason if a forecast is blocked with none. */
function blockingReason(findings: { severity: string; code: string }[]): string {
  return findings.find((f) => f.severity === "blocking")?.code ?? "forecast_failed";
}

function evaluateCell(
  input: ForecastInput,
  facts: ExtractedFactLike[],
  rowAxis: Axis,
  rowValue: number,
  columnAxis: Axis,
  columnValue: number,
  output: SensitivityOutput,
  ratios: CustomRatioInput[],
  mode: AveragingMode,
  isBase: boolean,
): SensitivityCell {
  const wrapped = withAxisDrivers(input, rowAxis, rowValue, columnAxis, columnValue);
  const forecast = runForecast(wrapped);

  if (!forecast.ok) {
    return { state: "failed", reason: blockingReason(forecast.findings), isBase };
  }

  if (output.kind === "lineItem") {
    const value = forecast.valueAt(output.key, output.periodKey);
    if (value === undefined || !Number.isFinite(value)) {
      return { state: "failed", reason: "forecast_missing_base", isBase };
    }
    return { state: "ok", value, isBase };
  }

  // The ratio path, spec section 8: no second entry point. The cell's own forecast
  // result becomes the workspace's forecast layer, and the same `computeRatios` the
  // Ratios tab uses reads the output period back out.
  const workspaceInput: WorkspaceInput = {
    periods: input.historicalPeriods,
    facts,
    overrides: [],
    forecast: { periods: input.forecastPeriods, valueAt: forecast.valueAt },
  };
  const workspace = buildWorkspace(workspaceInput);
  const results = computeRatios({ workspace, mode, custom: ratios });
  const ratioResult = results.find((r) => r.key === output.key);
  const period = ratioResult?.periods.find((p) => p.periodKey === output.periodKey);

  if (!ratioResult || !period) {
    return { state: "failed", reason: "unavailable", isBase };
  }
  if (period.state !== "ok" || period.value === undefined) {
    return { state: "failed", reason: period.state, isBase };
  }
  return { state: "ok", value: period.value, isBase };
}

export function sensitivityGrid(
  input: ForecastInput,
  rowAxis: Axis,
  columnAxis: Axis,
  output: SensitivityOutput,
  ratios: CustomRatioInput[],
  mode: AveragingMode,
): SensitivityResult {
  const rows = axisValues(rowAxis);
  const columns = axisValues(columnAxis);
  const facts = historicalFacts(input);

  // The scenario's own current values, read from the UNWRAPPED `driverAt` at the
  // output's period — never assumed to be the centre cell. Exact equality, not
  // `closeEnough`: an axis value and a driver value are both exact by construction, so
  // a base case is either the same double or it is not on the axis at all.
  const currentRowValue = input.driverAt(rowAxis.driverKey, output.periodKey);
  const currentColumnValue = input.driverAt(columnAxis.driverKey, output.periodKey);

  const cells = rows.map((rowValue) =>
    columns.map((columnValue) => {
      const isBase = rowValue === currentRowValue && columnValue === currentColumnValue;
      return evaluateCell(input, facts, rowAxis, rowValue, columnAxis, columnValue, output, ratios, mode, isBase);
    }),
  );

  return { rows, columns, cells };
}
