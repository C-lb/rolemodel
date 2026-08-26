import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import * as schema from "@/db/schema";
import { realDeps } from "@/server/deps";
import { loadWorkspace } from "@/server/documents";
import { isWorkspaceNotFound } from "@/server/errors";
import { listScenarios, readDrivers } from "@/server/scenarios";
import { assembleForecast } from "@/server/forecast";
import { computeRatios } from "@/model/ratios/compute";
import { extendAnnualPeriods, sortPeriodsMostRecentFirst } from "@/model/periods";
import { WorkspaceScreen } from "./WorkspaceScreen";
import type { ForecastPanelData } from "./WorkspaceForecast";

/**
 * The forecast tab's data, assembled server-side so the client component holds no
 * financial logic — the same rule the statements and ratios already follow. Scenarios
 * are never auto-created here: a GET request that writes to the database would make a
 * page reload a mutation, so an empty scenario list is a real state `WorkspaceForecast`
 * renders its own call to action for (`createScenarioAction` with an empty name).
 */
async function loadForecastPanel(
  deps: ReturnType<typeof realDeps>,
  workspaceId: string,
  historicalPeriods: string[],
): Promise<ForecastPanelData> {
  const [workspaceRow] = deps.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).all();
  const horizon = workspaceRow?.forecastHorizon ?? 5;

  if (historicalPeriods.length === 0) {
    return { scenarios: [], activeScenarioId: null, horizon, forecastPeriods: [], drivers: [], ok: false, findings: [], cells: [] };
  }

  const scenarioRows = await listScenarios(deps, workspaceId);
  const scenarios = scenarioRows.map((s) => ({ id: s.id, name: s.name, isBase: s.isBase }));

  if (scenarios.length === 0) {
    return { scenarios: [], activeScenarioId: null, horizon, forecastPeriods: [], drivers: [], ok: false, findings: [], cells: [] };
  }

  const activeScenarioId = workspaceRow?.activeScenarioId
    ?? scenarioRows.find((s) => s.isBase)?.id
    ?? scenarios[0].id;

  const latest = sortPeriodsMostRecentFirst(historicalPeriods)[0];
  const forecastPeriods = latest !== undefined ? extendAnnualPeriods(latest, horizon) : [];

  const driverRows = await readDrivers(deps, activeScenarioId);
  const drivers = driverRows.map((d) => ({
    key: d.key, periodKey: d.periodKey, value: d.value, basis: d.basis, note: d.note,
  }));

  const forecastResult = await assembleForecast(deps, workspaceId, activeScenarioId);

  return {
    scenarios,
    activeScenarioId,
    horizon,
    forecastPeriods,
    drivers,
    ok: forecastResult.ok,
    findings: forecastResult.findings,
    cells: forecastResult.ok
      ? forecastResult.cells.map((c) => ({
          canonicalKey: c.canonicalKey, periodKey: c.periodKey, value: c.value, formula: c.formula, inputs: c.inputs,
        }))
      : [],
  };
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

  // Ratios are computed here, on the server, so the screen receives values rather than
  // the means to compute them. Same rule the statements follow.
  const ratios = computeRatios({ workspace: ws, mode: ws.averagingMode, custom: ws.customRatios });
  const forecast = await loadForecastPanel(deps, id, ws.periods);

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
      statements={{
        income: ws.statement("income"),
        balance: ws.statement("balance"),
        cashflow: ws.statement("cashflow"),
      }}
    />
  );
}
