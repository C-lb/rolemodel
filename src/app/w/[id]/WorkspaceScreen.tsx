"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { StatementRow, Cell } from "@/model/workspace";
import type { Finding } from "@/model/validate";
import { StatementTable, droppedRowKey } from "@/ui/StatementTable";
import { RemapDrawer, type UnmappedFact } from "@/ui/RemapDrawer";
import { ProvenancePanel } from "@/ui/ProvenancePanel";
import { Banner } from "@/ui/Banner";
import { useToast } from "@/ui/ToastProvider";
import { tooltip } from "@/ui/tooltips";
import { Tooltip } from "@/ui/Tooltip";
import { UNMAPPED_KEY } from "@/model/taxonomy";
import { RATIO_FAMILIES } from "@/model/ratios/types";
import { CORE_KEYS } from "@/model/ratios/library";
import type { AveragingMode, RatioFamily } from "@/model/ratios/types";
import { computeRatios, dupont, type CustomRatioInput, type RatioPeriodResult, type RatioResult } from "@/model/ratios/compute";
import { buildWorkspace, type ExtractedFactLike, type OverrideLike } from "@/model/workspace";
import { RatioCard, type ReadingState } from "@/ui/RatioCard";
import { RatioSection } from "@/ui/RatioSection";
import { RatioBuilder, type RatioDraft } from "@/ui/RatioBuilder";
import { DupontCard } from "@/ui/DupontCard";
import { WorkspaceForecast, type ForecastPanelData } from "./WorkspaceForecast";
import {
  saveOverride, clearOverride, remapLineItem,
  setAveraging, saveRatio, deleteRatio, explainRatio,
} from "@/app/actions";

interface Statements {
  income: StatementRow[];
  balance: StatementRow[];
  cashflow: StatementRow[];
}

interface Props {
  workspaceId: string;
  documentName: string;
  periods: string[];
  findings: Finding[];
  statements: Statements;
  unmapped: UnmappedFact[];
  /** Computed on the server, so the view holds no financial logic. */
  ratios: RatioResult[];
  customRatios: CustomRatioInput[];
  averagingMode: AveragingMode;
  /** Absent only in a test that predates the forecast tab; production always supplies it. */
  forecast?: ForecastPanelData;
}

type WorkspaceView = "statements" | "ratios" | "forecast";

const EMPTY_FORECAST: ForecastPanelData = {
  scenarios: [], activeScenarioId: null, horizon: 5, forecastPeriods: [], drivers: [], ok: false, findings: [], cells: [],
};

const FAMILY_TITLES: Record<RatioFamily, string> = {
  liquidity: "Liquidity",
  leverage: "Leverage",
  efficiency: "Efficiency",
  profitability: "Profitability",
  coverage: "Coverage",
};

type SaveResult = Awaited<ReturnType<typeof saveOverride>>;

interface SaveFailure {
  message: string;
  remediation: string;
  retry: () => void;
}

const STATEMENT_TITLES: [keyof Statements, string][] = [
  ["income", "Income statement"],
  ["balance", "Balance sheet"],
  ["cashflow", "Cash flow"],
];

const cellId = (key: string, period: string) => `${key}::${period}`;

/**
 * Identity of one finding. Several findings share a code and a period (one per
 * subtotal, one per conflicting cell, one per missing statement), so the keys
 * they carry are what tells them apart. Dismissing one must not hide its siblings.
 */
const findingId = (f: Finding) => `${f.code}:${f.periodKey}:${f.keys.join(",")}`;


export function WorkspaceScreen({
  workspaceId, documentName, periods, findings, statements, unmapped,
  ratios, customRatios, averagingMode, forecast = EMPTY_FORECAST,
}: Props) {
  const [inspected, setInspected] = useState<Cell | null>(null);
  const [view, setView] = useState<WorkspaceView>("statements");
  const [coreOnly, setCoreOnly] = useState(false);
  const [building, setBuilding] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [readings, setReadings] = useState<Record<string, ReadingState>>({});
  const [dragging, setDragging] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);
  // Whether the save/reset/undo path currently has a request in flight. This is
  // its own state rather than useTransition's `isPending`, because `isPending`
  // only flips back once the whole async transition callback has settled - one
  // render later than the setSaveFailure update that reports the same outcome.
  // Gating the "Try again" button on `isPending` therefore has a real render in
  // between where the failure banner is up but the button is not: a save that
  // failed would briefly look like it could not be retried. Flipping this flag
  // in the same synchronous continuation as setSaveFailure keeps both in one commit.
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  // A drag needs a few pixels of travel before it starts, so a click on the grip
  // is still a click. The keyboard sensor keeps a picked-up figure movable without
  // a mouse; the dropdown on each chip is the plain, complete keyboard path.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  // One index over every cell on screen, so the previous value behind an edit is
  // looked up in one place rather than re-scanned per statement.
  const cells = useMemo(() => {
    const index = new Map<string, Cell>();
    for (const rows of Object.values(statements)) {
      for (const row of rows) {
        for (const cell of row.cells) index.set(cellId(cell.canonicalKey, cell.periodKey), cell);
      }
    }
    return index;
  }, [statements]);

  /**
   * Run one persistence action. A failure raises a blocking banner carrying the
   * action's own remediation and a retry of exactly the attempt that failed, so
   * a save that did not land can never read as one that did.
   */
  function perform(action: () => Promise<SaveResult>, onSaved: () => void) {
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
        onSaved();
      });
    };

    run();
  }

  /** Put a cell back the way it was: the user's earlier figure, or the extracted one. */
  function restore(key: string, period: string, previous: number | undefined) {
    perform(
      () => (previous === undefined
        ? clearOverride(workspaceId, key, period)
        : saveOverride(workspaceId, key, period, previous)),
      () => {},
    );
  }

  function edit(key: string, period: string, value: number) {
    const before = cells.get(cellId(key, period));
    const previousOverride = before?.source === "override" ? before.value : undefined;

    perform(
      () => saveOverride(workspaceId, key, period, value),
      () => toast.show("Value updated", { undo: () => restore(key, period, previousOverride) }),
    );
  }

  function reset(key: string, period: string) {
    const discarded = cells.get(cellId(key, period))?.value;

    perform(
      () => clearOverride(workspaceId, key, period),
      () => toast.show("Restored the extracted value", {
        undo: discarded === undefined ? undefined : () => restore(key, period, discarded),
      }),
    );
  }

  /**
   * Move one figure to a line item. A refusal (the target line already holds a
   * value for that period) is the user's request being declined, not a save
   * that went missing, so it reads as a toast rather than a blocking banner.
   */
  function remap(factId: string, toKey: string, undone = false) {
    startTransition(async () => {
      const result = await remapLineItem(workspaceId, factId, toKey);
      if (!result.ok) {
        toast.show(result.message);
        return;
      }
      router.refresh();
      if (undone) {
        toast.show("Moved back to unmapped");
        return;
      }
      toast.show("Line item moved", { undo: () => remap(factId, UNMAPPED_KEY, true) });
    });
  }

  /**
   * The builder's preview runs the same engine the server does, over the figures already
   * on screen. It is a pure computation over data the client holds, so it needs no round
   * trip, and an expression that resolves to nothing is visible before it is saved.
   */
  const factsAndOverrides = useMemo(() => {
    const facts: ExtractedFactLike[] = [];
    const overrides: OverrideLike[] = [];
    for (const cell of cells.values()) {
      if (cell.extractedValue !== undefined) {
        facts.push({
          canonicalKey: cell.canonicalKey,
          periodKey: cell.periodKey,
          value: cell.extractedValue,
          confidence: cell.confidence ?? 1,
          provenance: cell.provenance ?? {
            page: null, sheet: null, locator: "", rawLabel: "", rawValue: "",
            scaleFactor: 1, scaleEvidence: "", signFlipped: false,
          },
        });
      }
      if (cell.source === "override" && cell.value !== undefined) {
        overrides.push({ canonicalKey: cell.canonicalKey, periodKey: cell.periodKey, value: cell.value });
      }
    }
    return { facts, overrides };
  }, [cells]);

  const previewWorkspace = useMemo(
    () => buildWorkspace({ periods, ...factsAndOverrides }),
    [factsAndOverrides, periods],
  );

  // Ratios gain forecast columns through the same workspace forecast layer the model
  // already builds (`buildWorkspace`'s `forecast` input) - never a second path (spec
  // §7). The layer only exists while a scenario's forecast has actually succeeded;
  // a blocked forecast leaves the Ratios tab exactly as it was before this task.
  const hasForecast = forecast.activeScenarioId !== null && forecast.ok && forecast.forecastPeriods.length > 0;
  const forecastValueIndex = useMemo(
    () => new Map(forecast.cells.map((c) => [cellId(c.canonicalKey, c.periodKey), c.value])),
    [forecast.cells],
  );
  const ratiosWorkspace = useMemo(() => {
    if (!hasForecast) return previewWorkspace;
    return buildWorkspace({
      periods,
      ...factsAndOverrides,
      forecast: {
        periods: forecast.forecastPeriods,
        valueAt: (key, period) => forecastValueIndex.get(cellId(key, period)),
      },
    });
  }, [hasForecast, previewWorkspace, periods, factsAndOverrides, forecast.forecastPeriods, forecastValueIndex]);
  const displayRatios = useMemo(
    () => (hasForecast ? computeRatios({ workspace: ratiosWorkspace, mode: averagingMode, custom: customRatios }) : ratios),
    [hasForecast, ratiosWorkspace, averagingMode, customRatios, ratios],
  );

  function previewExpression(expression: string): RatioPeriodResult[] {
    const computed = computeRatios({
      workspace: previewWorkspace,
      mode: averagingMode,
      custom: [{ key: "__preview", label: "Preview", expression, note: null }],
    });
    return computed.find((r) => r.key === "__preview")?.periods ?? [];
  }

  /** Ask for the generated half of one card. The numbers stay on screen throughout. */
  function explain(key: string) {
    setReadings((current) => ({ ...current, [key]: { state: "loading" } }));
    startTransition(async () => {
      const result = await explainRatio(workspaceId, key);
      setReadings((current) => ({
        ...current,
        [key]: result.ok
          ? result.data.declined
            ? { state: "declined", reason: result.data.reason }
            : { state: "ready", text: result.data.text }
          : { state: "failed", message: result.message },
      }));
    });
  }

  function chooseAveraging(mode: AveragingMode) {
    if (mode === averagingMode) return;
    startTransition(async () => {
      const result = await setAveraging(workspaceId, mode);
      if (!result.ok) {
        toast.show(result.message);
        return;
      }
      // Every cached reading described the previous convention's numbers.
      setReadings({});
      router.refresh();
    });
  }

  function persistRatio(draft: RatioDraft, onSaved: () => void) {
    startTransition(async () => {
      const result = await saveRatio(workspaceId, draft);
      if (!result.ok) {
        setBuilderError(result.message);
        return;
      }
      setBuilderError(null);
      router.refresh();
      onSaved();
    });
  }

  function removeRatio(key: string) {
    const removed = customRatios.find((r) => r.key === key);
    startTransition(async () => {
      const result = await deleteRatio(workspaceId, key);
      if (!result.ok) {
        toast.show(result.message);
        return;
      }
      router.refresh();
      toast.show("Ratio deleted", {
        undo: removed
          ? () => persistRatio(
              { label: removed.label, expression: removed.expression, note: removed.note },
              () => toast.show("Ratio restored"),
            )
          : undefined,
      });
    });
  }

  /** A ratio component points back at the cell it came from, so provenance is one click away. */
  function inspectComponent(canonicalKey: string, periodKey: string) {
    const cell = cells.get(cellId(canonicalKey, periodKey));
    if (cell) setInspected(cell);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(false);
    const toKey = droppedRowKey(event.over?.id);
    if (toKey === null) return;
    remap(String(event.active.id), toKey);
  }

  const visible = findings.filter((f) => !dismissed.has(findingId(f)));
  const builtIn = displayRatios.filter((r) => !r.isCustom);
  const shown = coreOnly ? builtIn.filter((r) => CORE_KEYS.includes(r.key)) : builtIn;
  const custom = displayRatios.filter((r) => r.isCustom);
  const decomposition = dupont(displayRatios, periods[0] ?? "");
  const hasFigures = STATEMENT_TITLES.some(([kind]) =>
    statements[kind].some((row) => row.cells.some((c) => c.value !== undefined)),
  );

  return (
    <DndContext
      // A fixed id: without one, dnd-kit numbers its screen-reader description
      // elements from a global counter that differs between the server render
      // and the client one, and React reports the mismatch on hydration.
      id="workspace-remap"
      sensors={sensors}
      onDragStart={() => setDragging(true)}
      onDragCancel={() => setDragging(false)}
      onDragEnd={handleDragEnd}
    >
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-2">
          <span className="block text-xs leading-snug text-neutral-500">Extracted statements</span>
          <h1 className="min-w-0 break-words text-xl font-semibold leading-snug text-neutral-100">{documentName}</h1>
          <p className="max-w-[68ch] text-sm leading-relaxed text-neutral-400">
            {periods.length} period{periods.length === 1 ? "" : "s"}. Double-click a figure to edit it, or
            press Enter on it. A single click, or Space, shows where it came from.
          </p>
        </header>

        {saveFailure && (
          <Banner
            severity="blocking"
            title="That edit was not saved"
            message={saveFailure.message}
            remediation={saveFailure.remediation}
            actionLabel="Try again"
            // The control goes away while a retry is in flight: Banner renders no
            // button without a handler, which is how it says "not now" here.
            onAction={saving ? undefined : saveFailure.retry}
          />
        )}

        {visible.length > 0 && (
          <div className="flex flex-col gap-2">
            {visible.map((f) => (
              <Banner
                key={findingId(f)}
                severity={f.severity}
                title={f.message}
                titleHelp={tooltip(`finding.${f.code}`)}
                remediation={f.remediation}
                // Only a blocking finding is undismissable — it means the workspace
                // is not safe to read as numbers. Warning and info are both, by
                // definition, things the user may act on and move past.
                onDismiss={f.severity !== "blocking"
                  ? () => setDismissed((prev) => new Set(prev).add(findingId(f)))
                  : undefined}
              />
            ))}
          </div>
        )}

        <div role="tablist" aria-label="Workspace views" className="flex flex-wrap gap-2">
          {([["statements", "Statements"], ["ratios", "Ratios"], ["forecast", "Forecast"]] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`whitespace-nowrap rounded-[10px] border px-4 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 ${
                view === id
                  ? "border-white/15 bg-white/[0.08] text-neutral-100"
                  : "border-white/10 text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "forecast" ? (
          <WorkspaceForecast
            workspaceId={workspaceId}
            historicalPeriods={periods}
            statements={statements}
            customRatios={customRatios}
            forecast={forecast}
          />
        ) : view === "ratios" ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip label={tooltip("control.ratio_focus")}>
                <div className="flex gap-2">
                  {([[false, "All 25"], [true, "Core 12"]] as const).map(([value, label]) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={coreOnly === value}
                      onClick={() => setCoreOnly(value)}
                      className={`whitespace-nowrap rounded-[10px] border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 ${
                        coreOnly === value
                          ? "border-white/15 bg-white/[0.08] text-neutral-100"
                          : "border-white/10 text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Tooltip>

              <Tooltip label={tooltip("control.ratio_averaging")}>
                <div className="flex gap-2">
                  {([["average", "Average balances"], ["ending", "Ending balances"]] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={averagingMode === mode}
                      onClick={() => chooseAveraging(mode)}
                      className={`whitespace-nowrap rounded-[10px] border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 ${
                        averagingMode === mode
                          ? "border-white/15 bg-white/[0.08] text-neutral-100"
                          : "border-white/10 text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Tooltip>

              <Tooltip label={tooltip("control.ratio_new")}>
                <button
                  type="button"
                  onClick={() => { setBuilderError(null); setBuilding(true); }}
                  className="whitespace-nowrap rounded-[10px] border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
                >
                  New ratio
                </button>
              </Tooltip>
            </div>

            {building && (
              <RatioBuilder
                onPreview={previewExpression}
                onSave={(draft) => persistRatio(draft, () => {
                  setBuilding(false);
                  toast.show("Ratio saved");
                })}
                onCancel={() => { setBuilding(false); setBuilderError(null); }}
                saveError={builderError}
              />
            )}

            <DupontCard result={decomposition} />

            {RATIO_FAMILIES.map((family) => {
              const inFamily = shown.filter((r) => r.family === family);
              return (
                <RatioSection key={family} title={FAMILY_TITLES[family]} count={inFamily.length}>
                  {inFamily.map((result) => (
                    <RatioCard
                      key={result.key}
                      result={result}
                      reading={readings[result.key]}
                      onExplain={explain}
                      onShowProvenance={inspectComponent}
                      forecastExcluded={hasForecast}
                    />
                  ))}
                </RatioSection>
              );
            })}

            <RatioSection title="Your ratios" count={custom.length}>
              {custom.map((result) => (
                <RatioCard
                  key={result.key}
                  result={result}
                  reading={readings[result.key]}
                  onExplain={explain}
                  onShowProvenance={inspectComponent}
                  onDelete={removeRatio}
                  forecastExcluded={hasForecast}
                />
              ))}
            </RatioSection>
          </div>
        ) : (
        <>
        <RemapDrawer facts={unmapped} onRemap={(factId, key) => remap(factId, key)} />

        {hasFigures ? (
          STATEMENT_TITLES.map(([kind, title]) => (
            <StatementTable
              key={kind}
              title={title}
              rows={statements[kind]}
              periods={periods}
              onEdit={edit}
              onReset={reset}
              onInspect={setInspected}
              revealEmptyRows={dragging}
            />
          ))
        ) : (
          <p className="max-w-[68ch] text-sm leading-relaxed text-neutral-400">
            No figures were extracted from this document, so there is nothing to show yet.
          </p>
        )}
        </>
        )}

        {inspected && (
          <ProvenancePanel
            cell={inspected}
            documentName={documentName}
            onClose={() => setInspected(null)}
            // The panel shows a stale copy of the cell once the override is gone,
            // so it closes on reset. The toast carries the outcome and the undo.
            onReset={() => {
              const { canonicalKey, periodKey } = inspected;
              setInspected(null);
              reset(canonicalKey, periodKey);
            }}
          />
        )}
      </main>
    </DndContext>
  );
}
