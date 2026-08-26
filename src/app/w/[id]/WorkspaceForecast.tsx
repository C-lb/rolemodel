"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Finding } from "@/model/validate";
import type { StatementRow } from "@/model/workspace";
import type { CustomRatioInput } from "@/model/ratios/compute";
import { ratio as builtinRatio, RATIOS } from "@/model/ratios/library";
import { DRIVER_KEYS, driver as driverDef } from "@/model/forecast/drivers";
import type { DriverBasis } from "@/model/forecast/seed";
import { HELD_AT_ZERO_KEYS, HELD_FLAT_KEYS } from "@/model/forecast/engine";
import type { Axis, SensitivityOutput, SensitivityResult } from "@/model/forecast/sensitivity";
import { formatMoney, formatRatio } from "@/ui/format";
import { ScenarioBar, type ScenarioTab } from "@/ui/ScenarioBar";
import { DriverGrid, type DriverRowData } from "@/ui/DriverGrid";
import { ForecastStatement, type ForecastCellData, type ForecastStatementRow } from "@/ui/ForecastStatement";
import { SensitivityGrid } from "@/ui/SensitivityGrid";
import { Banner } from "@/ui/Banner";
import { Tooltip } from "@/ui/Tooltip";
import { tooltip } from "@/ui/tooltips";
import { useToast } from "@/ui/ToastProvider";
import {
  createScenarioAction,
  renameScenarioAction,
  duplicateScenarioAction,
  deleteScenarioAction,
  selectScenarioAction,
  saveDriverAction,
  fillRightAction,
  setHorizonAction,
  runSensitivityAction,
} from "@/app/actions";

/** A driver row as read from the database, flattened for the client. */
export interface DriverValue {
  key: string;
  periodKey: string;
  value: number;
  basis: DriverBasis | "user";
  note: string;
}

/** A forecast cell as `ForecastResult.cells` produces it — plain data, safe to pass from a server component. */
export interface ForecastCellValue {
  canonicalKey: string;
  periodKey: string;
  value: number;
  formula: string;
  inputs: { label: string; value: number }[];
}

export interface ForecastPanelData {
  scenarios: ScenarioTab[];
  activeScenarioId: string | null;
  horizon: number;
  forecastPeriods: string[];
  drivers: DriverValue[];
  ok: boolean;
  findings: Finding[];
  cells: ForecastCellValue[];
}

interface Statements {
  income: StatementRow[];
  balance: StatementRow[];
  cashflow: StatementRow[];
}

const STATEMENT_TITLES: [keyof Statements, string][] = [
  ["income", "Income statement"],
  ["balance", "Balance sheet"],
  ["cashflow", "Cash flow"],
];

interface Props {
  workspaceId: string;
  historicalPeriods: string[];
  statements: Statements;
  customRatios: CustomRatioInput[];
  forecast: ForecastPanelData;
}

type ActionOutcome = { ok: true; data: unknown } | { ok: false; message: string; remediation: string };

interface SaveFailure {
  message: string;
  remediation: string;
  retry: () => void;
}

/** Line-item and ratio options a sensitivity run's output metric picker offers. */
interface MetricOption {
  value: string;
  label: string;
  kind: "lineItem" | "ratio";
  key: string;
}

const STEP_OPTIONS = [3, 5, 7] as const;

function metricOptions(statements: Statements, custom: CustomRatioInput[]): MetricOption[] {
  const lineItems: MetricOption[] = [];
  const seen = new Set<string>();
  for (const rows of Object.values(statements)) {
    for (const row of rows) {
      if (seen.has(row.def.key)) continue;
      seen.add(row.def.key);
      lineItems.push({ value: `lineItem:${row.def.key}`, label: row.def.label, kind: "lineItem", key: row.def.key });
    }
  }
  const ratios: MetricOption[] = [
    ...RATIOS.map((r) => ({ value: `ratio:${r.key}`, label: r.label, kind: "ratio" as const, key: r.key })),
    ...custom.map((r) => ({ value: `ratio:${r.key}`, label: r.label, kind: "ratio" as const, key: r.key })),
  ];
  return [...lineItems, ...ratios];
}

function ratioUnitFor(key: string): "x" | "percent" | "days" | "currency" {
  return builtinRatio(key)?.unit ?? "x";
}

/** `${name} copy`, `${name} copy 2`, ... — the first candidate not already in use. */
function disambiguateCopyName(base: string, existing: string[]): string {
  let candidate = `${base} copy`;
  let n = 2;
  while (existing.includes(candidate)) {
    candidate = `${base} copy ${n}`;
    n += 1;
  }
  return candidate;
}

/**
 * Builds the rows `ForecastStatement` renders: the historical columns from the
 * Statements tab's own data (never recomputed here — one source of truth for a
 * historical figure), followed by the forecast columns from `ForecastResult.cells`.
 * Historical periods are read oldest-first so the seam reads left to right,
 * chronologically, with the forecast to its right.
 */
function buildForecastRows(
  rows: StatementRow[],
  ascendingHistoricalPeriods: string[],
  forecastPeriods: string[],
  cellIndex: Map<string, ForecastCellValue>,
): ForecastStatementRow[] {
  return rows.map((row) => {
    const key = row.def.key;
    const byPeriod = new Map(row.cells.map((c) => [c.periodKey, c]));
    const historicalCells: ForecastCellData[] = ascendingHistoricalPeriods.map((p) => ({
      kind: "historical",
      periodKey: p,
      value: byPeriod.get(p)?.value,
    }));
    const forecastCells: ForecastCellData[] = forecastPeriods.map((p) => {
      const fc = cellIndex.get(`${key}::${p}`);
      return {
        kind: "forecast",
        periodKey: p,
        value: fc?.value,
        formula: fc?.formula ?? "",
        inputs: fc?.inputs ?? [],
      };
    });
    return {
      key,
      label: row.def.label,
      isSubtotal: row.def.isSubtotal,
      indent: row.def.parentKey !== null,
      heldFlat: HELD_FLAT_KEYS.has(key),
      heldAtZero: HELD_AT_ZERO_KEYS.includes(key),
      cells: [...historicalCells, ...forecastCells],
    };
  });
}

interface ExplainState {
  rowLabel: string;
  periodKey: string;
  formula: string;
  inputs: { label: string; value: number }[];
}

/** A minimal panel for a forecast cell's own provenance: the formula and inputs the engine used. */
function ForecastExplainPanel({ state, onClose }: { state: ExplainState; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label={`How ${state.rowLabel} was forecast for ${state.periodKey}`}
      className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-neutral-900 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium text-neutral-200">
          {state.rowLabel}, {state.periodKey}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-[10px] px-2 py-1 text-xs text-neutral-400 hover:bg-white/10"
        >
          Close
        </button>
      </div>
      <code className="block break-words rounded-[10px] bg-white/[0.04] px-2.5 py-1.5 font-mono text-xs leading-relaxed text-neutral-300">
        {state.formula || "No formula — this figure is held rather than computed."}
      </code>
      {state.inputs.length > 0 && (
        <dl className="flex flex-col gap-1 text-xs leading-relaxed">
          {state.inputs.map((input) => (
            <div key={input.label} className="flex items-baseline justify-between gap-4">
              <dt className="text-neutral-500">{input.label}</dt>
              <dd className="tabular-nums text-neutral-300">{formatMoney(input.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function WorkspaceForecast({
  workspaceId,
  historicalPeriods,
  statements,
  customRatios,
  forecast,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);
  const [explainState, setExplainState] = useState<ExplainState | null>(null);

  const options = useMemo(() => metricOptions(statements, customRatios), [statements, customRatios]);
  const [rowDriver, setRowDriver] = useState(DRIVER_KEYS[0]);
  const [rowMin, setRowMin] = useState(0);
  const [rowMax, setRowMax] = useState(0.1);
  const [rowSteps, setRowSteps] = useState<3 | 5 | 7>(3);
  const [colDriver, setColDriver] = useState(DRIVER_KEYS[1] ?? DRIVER_KEYS[0]);
  const [colMin, setColMin] = useState(0);
  const [colMax, setColMax] = useState(0.1);
  const [colSteps, setColSteps] = useState<3 | 5 | 7>(3);
  const [outputMetric, setOutputMetric] = useState(options[0]?.value ?? "");
  const [outputPeriod, setOutputPeriod] = useState(forecast.forecastPeriods[0] ?? "");
  const [sensitivity, setSensitivity] = useState<SensitivityResult | null>(null);
  const [sensitivityError, setSensitivityError] = useState<string | null>(null);
  const [runningSensitivity, setRunningSensitivity] = useState(false);

  /** Mirrors `WorkspaceScreen.perform`: `saving` flips in the same synchronous
   * continuation as `setSaveFailure`, never read from `useTransition`'s `isPending`,
   * which lags one render behind a state update made inside the same transition. */
  function perform(action: () => Promise<ActionOutcome>, onDone: () => void) {
    const run = () => {
      setSaving(true);
      startTransition(async () => {
        const result = await action();
        if (!result.ok) {
          setSaveFailure({ message: result.message, remediation: result.remediation, retry: run });
          setSaving(false);
          return;
        }
        setSaveFailure(null);
        setSaving(false);
        router.refresh();
        onDone();
      });
    };
    run();
  }

  if (forecast.scenarios.length === 0 || forecast.activeScenarioId === null) {
    return (
      <div className="flex flex-col gap-4">
        <p className="max-w-[68ch] text-sm leading-relaxed text-neutral-400">
          {historicalPeriods.length === 0
            ? "There are no extracted figures to forecast from yet."
            : "This workspace has no scenarios yet. Creating one seeds a Base, Bull and Bear scenario with drivers derived from this workspace's history."}
        </p>
        {historicalPeriods.length > 0 && (
          <Tooltip label={tooltip("control.forecast_setup")}>
            <button
              type="button"
              onClick={() => perform(() => createScenarioAction(workspaceId, ""), () => toast.show("Scenarios created"))}
              disabled={saving}
              className="w-fit whitespace-nowrap rounded-[10px] border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:text-neutral-600"
            >
              Set up scenarios
            </button>
          </Tooltip>
        )}
      </div>
    );
  }

  const activeScenarioId = forecast.activeScenarioId;
  const scenarioNames = forecast.scenarios.map((s) => s.name);

  function selectScenario(id: string) {
    perform(() => selectScenarioAction(workspaceId, id), () => {});
  }

  function addScenario(name: string) {
    perform(() => createScenarioAction(workspaceId, name), () => toast.show("Scenario created"));
  }

  function renameScenario(id: string, name: string) {
    perform(() => renameScenarioAction(workspaceId, id, name), () => {});
  }

  function duplicateScenario(id: string) {
    const source = forecast.scenarios.find((s) => s.id === id);
    if (!source) return;
    const name = disambiguateCopyName(source.name, scenarioNames);
    perform(() => duplicateScenarioAction(workspaceId, id, name), () => toast.show(`Duplicated as "${name}"`));
  }

  function removeScenario(id: string) {
    perform(() => deleteScenarioAction(workspaceId, id), () => toast.show("Scenario deleted"));
  }

  function changeHorizon(horizon: number) {
    perform(() => setHorizonAction(workspaceId, horizon), () => {});
  }

  function commitDriver(driverKey: string, periodKey: string, value: number) {
    perform(() => saveDriverAction(workspaceId, activeScenarioId, driverKey, periodKey, value), () => {});
  }

  function fillDriverRight(driverKey: string, sourcePeriodKey: string) {
    perform(
      () => fillRightAction(workspaceId, activeScenarioId, driverKey, sourcePeriodKey),
      () => toast.show("Filled right"),
    );
  }

  function runSensitivity() {
    const option = options.find((o) => o.value === outputMetric);
    if (!option || outputPeriod === "") return;
    const output: SensitivityOutput = { kind: option.kind, key: option.key, periodKey: outputPeriod };
    const rowAxis: Axis = { driverKey: rowDriver, min: rowMin, max: rowMax, steps: rowSteps };
    const columnAxis: Axis = { driverKey: colDriver, min: colMin, max: colMax, steps: colSteps };
    setRunningSensitivity(true);
    startTransition(async () => {
      const result = await runSensitivityAction(workspaceId, activeScenarioId, rowAxis, columnAxis, output);
      setRunningSensitivity(false);
      if (!result.ok) {
        setSensitivityError(result.message);
        setSensitivity(null);
        return;
      }
      setSensitivityError(null);
      setSensitivity(result.data);
    });
  }

  const driverRows: DriverRowData[] = DRIVER_KEYS.map((key) => ({
    key,
    cells: forecast.forecastPeriods.map((periodKey) => {
      const row = forecast.drivers.find((d) => d.key === key && d.periodKey === periodKey);
      return {
        periodKey,
        value: row?.value ?? 0,
        seed: row && row.basis !== "user" ? { basis: row.basis, note: row.note } : undefined,
      };
    }),
  }));

  const ascendingHistoricalPeriods = [...historicalPeriods].reverse();
  const cellIndex = new Map(forecast.cells.map((c) => [`${c.canonicalKey}::${c.periodKey}`, c]));
  const blockingFinding = forecast.findings.find((f) => f.severity === "blocking");

  const selectedOption = options.find((o) => o.value === outputMetric);
  const formatOutputValue = (value: number) =>
    selectedOption?.kind === "ratio" ? formatRatio(value, ratioUnitFor(selectedOption.key)) : formatMoney(value);

  return (
    <div className="flex flex-col gap-6">
      {saveFailure && (
        <Banner
          severity="blocking"
          title="That change was not saved"
          message={saveFailure.message}
          remediation={saveFailure.remediation}
          actionLabel="Try again"
          onAction={saving ? undefined : saveFailure.retry}
        />
      )}

      <ScenarioBar
        scenarios={forecast.scenarios}
        activeId={activeScenarioId}
        horizon={forecast.horizon}
        onSelect={selectScenario}
        onAdd={addScenario}
        onRename={renameScenario}
        onDuplicate={duplicateScenario}
        onDelete={removeScenario}
        onHorizonChange={changeHorizon}
      />

      {!forecast.ok ? (
        <Banner
          severity="blocking"
          title={blockingFinding?.message ?? "This scenario cannot be forecast."}
          remediation={blockingFinding?.remediation ?? "Change the historical periods or drivers and try again."}
        />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium leading-snug text-neutral-300">Drivers</h2>
            <DriverGrid rows={driverRows} periods={forecast.forecastPeriods} onCommit={commitDriver} onFillRight={fillDriverRight} />
          </section>

          {STATEMENT_TITLES.map(([kind, title]) => (
            <ForecastStatement
              key={kind}
              title={title}
              rows={buildForecastRows(statements[kind], ascendingHistoricalPeriods, forecast.forecastPeriods, cellIndex)}
              onExplain={(row, cell) =>
                setExplainState({ rowLabel: row.label, periodKey: cell.periodKey, formula: cell.formula, inputs: cell.inputs })
              }
            />
          ))}

          {explainState && <ForecastExplainPanel state={explainState} onClose={() => setExplainState(null)} />}

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium leading-snug text-neutral-300">Sensitivity</h2>
            <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-white/[0.06] bg-neutral-900/60 p-4 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-neutral-400">Row driver</span>
                <Tooltip label={tooltip("control.sensitivity_row_driver")}>
                  <select
                    aria-label="Sensitivity row driver"
                    value={rowDriver}
                    onChange={(e) => setRowDriver(e.target.value)}
                    className="rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1.5 text-neutral-100"
                  >
                    {DRIVER_KEYS.map((key) => (
                      <option key={key} value={key}>{driverDef(key)?.label ?? key}</option>
                    ))}
                  </select>
                </Tooltip>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-neutral-400">Row min</span>
                <Tooltip label={tooltip("control.sensitivity_row_min")}>
                  <input
                    aria-label="Sensitivity row minimum"
                    type="number"
                    value={rowMin}
                    onChange={(e) => setRowMin(Number(e.target.value))}
                    className="w-20 rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1.5 text-neutral-100"
                  />
                </Tooltip>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-neutral-400">Row max</span>
                <Tooltip label={tooltip("control.sensitivity_row_max")}>
                  <input
                    aria-label="Sensitivity row maximum"
                    type="number"
                    value={rowMax}
                    onChange={(e) => setRowMax(Number(e.target.value))}
                    className="w-20 rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1.5 text-neutral-100"
                  />
                </Tooltip>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-neutral-400">Row steps</span>
                <Tooltip label={tooltip("control.sensitivity_row_steps")}>
                  <select
                    aria-label="Sensitivity row steps"
                    value={rowSteps}
                    onChange={(e) => setRowSteps(Number(e.target.value) as 3 | 5 | 7)}
                    className="rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1.5 text-neutral-100"
                  >
                    {STEP_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </Tooltip>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-neutral-400">Column driver</span>
                <Tooltip label={tooltip("control.sensitivity_column_driver")}>
                  <select
                    aria-label="Sensitivity column driver"
                    value={colDriver}
                    onChange={(e) => setColDriver(e.target.value)}
                    className="rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1.5 text-neutral-100"
                  >
                    {DRIVER_KEYS.map((key) => (
                      <option key={key} value={key}>{driverDef(key)?.label ?? key}</option>
                    ))}
                  </select>
                </Tooltip>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-neutral-400">Column min</span>
                <Tooltip label={tooltip("control.sensitivity_column_min")}>
                  <input
                    aria-label="Sensitivity column minimum"
                    type="number"
                    value={colMin}
                    onChange={(e) => setColMin(Number(e.target.value))}
                    className="w-20 rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1.5 text-neutral-100"
                  />
                </Tooltip>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-neutral-400">Column max</span>
                <Tooltip label={tooltip("control.sensitivity_column_max")}>
                  <input
                    aria-label="Sensitivity column maximum"
                    type="number"
                    value={colMax}
                    onChange={(e) => setColMax(Number(e.target.value))}
                    className="w-20 rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1.5 text-neutral-100"
                  />
                </Tooltip>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-neutral-400">Column steps</span>
                <Tooltip label={tooltip("control.sensitivity_column_steps")}>
                  <select
                    aria-label="Sensitivity column steps"
                    value={colSteps}
                    onChange={(e) => setColSteps(Number(e.target.value) as 3 | 5 | 7)}
                    className="rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1.5 text-neutral-100"
                  >
                    {STEP_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </Tooltip>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-neutral-400">Output metric</span>
                <Tooltip label={tooltip("control.sensitivity_output_metric")}>
                  <select
                    aria-label="Sensitivity output metric"
                    value={outputMetric}
                    onChange={(e) => setOutputMetric(e.target.value)}
                    className="rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1.5 text-neutral-100"
                  >
                    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Tooltip>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-neutral-400">Output period</span>
                <Tooltip label={tooltip("control.sensitivity_output_period")}>
                  <select
                    aria-label="Sensitivity output period"
                    value={outputPeriod}
                    onChange={(e) => setOutputPeriod(e.target.value)}
                    className="rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1.5 text-neutral-100"
                  >
                    {forecast.forecastPeriods.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Tooltip>
              </label>

              <Tooltip label={tooltip("control.sensitivity_run")}>
                <button
                  type="button"
                  onClick={runSensitivity}
                  disabled={runningSensitivity}
                  className="whitespace-nowrap rounded-[10px] border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:text-neutral-600"
                >
                  Run sensitivity
                </button>
              </Tooltip>
            </div>

            {sensitivityError && (
              <Banner severity="warning" title="The sensitivity grid could not be run" message={sensitivityError} remediation="Adjust the inputs and try again." />
            )}

            {sensitivity && (
              <SensitivityGrid
                result={sensitivity}
                rowLabel={driverDef(rowDriver)?.label ?? rowDriver}
                columnLabel={driverDef(colDriver)?.label ?? colDriver}
                rowUnit={driverDef(rowDriver)?.unit ?? "currency"}
                columnUnit={driverDef(colDriver)?.unit ?? "currency"}
                formatValue={formatOutputValue}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
