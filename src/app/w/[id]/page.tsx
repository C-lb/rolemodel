import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import * as schema from "@/db/schema";
import { realDeps } from "@/server/deps";
import { loadWorkspace } from "@/server/documents";
import { isWorkspaceNotFound } from "@/server/errors";
import { listScenarios, readDrivers } from "@/server/scenarios";
import { assembleForecast } from "@/server/forecast";
import { buildWorkspace, type ExtractedFactLike, type OverrideLike, type StatementRow } from "@/model/workspace";
import { computeRatios, type RatioResult } from "@/model/ratios/compute";
import type { ForecastResult } from "@/model/forecast/engine";
import { extendAnnualPeriods, sortPeriodsMostRecentFirst } from "@/model/periods";
import { WorkspaceScreen } from "./WorkspaceScreen";
import type { ForecastPanelData } from "./WorkspaceForecast";

interface ScenarioContext {
  scenarios: { id: string; name: string; isBase: boolean }[];
  activeScenarioId: string | null;
  horizon: number;
  forecastPeriods: string[];
  driverRows: Awaited<ReturnType<typeof readDrivers>>;
  forecastResult: ForecastResult | null;
}

/**
 * Scenarios are never auto-created here: a GET request that writes to the database
 * would make a page reload a mutation, so an empty scenario list is a real state
 * `WorkspaceForecast` renders its own call to action for (`createScenarioAction` with
 * an empty name).
 */
async function loadScenarioContext(
  deps: ReturnType<typeof realDeps>,
  workspaceId: string,
  historicalPeriods: string[],
): Promise<ScenarioContext> {
  const [workspaceRow] = deps.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).all();
  const horizon = workspaceRow?.forecastHorizon ?? 5;
  const empty: ScenarioContext = {
    scenarios: [], activeScenarioId: null, horizon, forecastPeriods: [], driverRows: [], forecastResult: null,
  };
  if (historicalPeriods.length === 0) return empty;

  const scenarioRows = await listScenarios(deps, workspaceId);
  const scenarios = scenarioRows.map((s) => ({ id: s.id, name: s.name, isBase: s.isBase }));
  if (scenarios.length === 0) return empty;

  const activeScenarioId = workspaceRow?.activeScenarioId
    ?? scenarioRows.find((s) => s.isBase)?.id
    ?? scenarios[0].id;

  const latest = sortPeriodsMostRecentFirst(historicalPeriods)[0];
  const forecastPeriods = latest !== undefined ? extendAnnualPeriods(latest, horizon) : [];
  const driverRows = await readDrivers(deps, activeScenarioId);
  const forecastResult = await assembleForecast(deps, workspaceId, activeScenarioId);

  return { scenarios, activeScenarioId, horizon, forecastPeriods, driverRows, forecastResult };
}

function toForecastPanel(context: ScenarioContext): ForecastPanelData {
  const drivers = context.driverRows.map((d) => ({
    key: d.key, periodKey: d.periodKey, value: d.value, basis: d.basis, note: d.note,
  }));

  return {
    scenarios: context.scenarios,
    activeScenarioId: context.activeScenarioId,
    horizon: context.horizon,
    forecastPeriods: context.forecastPeriods,
    drivers,
    ok: context.forecastResult?.ok ?? false,
    findings: context.forecastResult?.findings ?? [],
    cells: context.forecastResult?.ok
      ? context.forecastResult.cells.map((c) => ({
          canonicalKey: c.canonicalKey, periodKey: c.periodKey, value: c.value, formula: c.formula, inputs: c.inputs,
        }))
      : [],
  };
}

/**
 * Rebuilds the `facts`/`overrides` `buildWorkspace` needs from a workspace's own
 * cells, rather than re-querying the database: every extracted or overridden cell
 * across the three statements is read back out exactly as `ws.cell` reports it, so a
 * second workspace built from this can never disagree with the first about a
 * historical figure.
 */
function factsAndOverridesFrom(ws: { statement(kind: StatementRow["def"]["statement"]): StatementRow[] }): {
  facts: ExtractedFactLike[];
  overrides: OverrideLike[];
} {
  const facts: ExtractedFactLike[] = [];
  const overrides: OverrideLike[] = [];
  for (const kind of ["income", "balance", "cashflow"] as const) {
    for (const row of ws.statement(kind)) {
      for (const cell of row.cells) {
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
    }
  }
  return { facts, overrides };
}

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deps = realDeps();

  let ws: Awaited<ReturnType<typeof loadWorkspace>>;
  try {
    ws = await loadWorkspace(deps, id);
  } catch (error) {
    // A missing workspace is a 404. Anything else is a real fault and must not be
    // disguised as one, so the test is the error's own type, not the wording of its
    // message: reformatting a sentence must never move this boundary.
    if (isWorkspaceNotFound(error)) notFound();
    throw error;
  }

  const scenarioContext = await loadScenarioContext(deps, id, ws.periods);
  const forecast = toForecastPanel(scenarioContext);

  // Ratios are computed here, on the server, so the screen receives values rather than
  // the means to compute them. Same rule the statements follow. When a scenario's
  // forecast has succeeded, the workspace fed to `computeRatios` carries the forecast
  // layer `buildWorkspace` already exposes (spec §7, no second path) — built from the
  // SAME historical facts and overrides `ws` itself holds, read back out through its
  // own cells rather than re-queried, so the historical figures can never disagree
  // with what the Statements tab shows. The screen and its ratio cards receive the
  // finished values; nothing recomputes in the browser.
  const forecastResult = scenarioContext.forecastResult;
  const ratiosWorkspace = forecastResult?.ok
    ? buildWorkspace({
        periods: ws.periods,
        ...factsAndOverridesFrom(ws),
        forecast: { periods: scenarioContext.forecastPeriods, valueAt: forecastResult.valueAt },
      })
    : ws;
  const ratios: RatioResult[] = computeRatios({ workspace: ratiosWorkspace, mode: ws.averagingMode, custom: ws.customRatios });

  return (
    <WorkspaceScreen
      workspaceId={id}
      documentName={ws.documentName}
      periods={ws.periods}
      findings={ws.findings}
      unmapped={ws.unmapped}
      ratios={ratios}
      customRatios={ws.customRatios}
      averagingMode={ws.averagingMode}
      forecast={forecast}
      hasForecast={forecastResult?.ok ?? false}
      statements={{
        income: ws.statement("income"),
        balance: ws.statement("balance"),
        cashflow: ws.statement("cashflow"),
      }}
    />
  );
}
