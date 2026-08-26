import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { runForecast, type ForecastInput, type ForecastResult } from "@/model/forecast/engine";
import type { DriverBasis } from "@/model/forecast/seed";
import { extendAnnualPeriods, sortPeriodsMostRecentFirst } from "@/model/periods";
import type { Deps } from "./documents";
import { loadWorkspace } from "./documents";
import { WorkspaceNotFoundError } from "./errors";

function requireWorkspace(deps: Deps, workspaceId: string): typeof schema.workspaces.$inferSelect {
  const [row] = deps.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).all();
  if (!row) throw new WorkspaceNotFoundError(workspaceId);
  return row;
}

/**
 * Assembles a `ForecastInput` from the workspace's history and a scenario's stored
 * drivers, and runs the engine. Errors are not this function's business: a workspace
 * that does not exist throws the same `WorkspaceNotFoundError` `loadWorkspace` does,
 * and everything else the engine finds — including the blocking `forecast_not_annual`
 * finding when the workspace's periods are quarterly — comes back inside the
 * `ForecastResult` exactly as `runForecast` produced it. Nothing here pre-empts that
 * gate; the engine is the one place spec §5.6's findings are decided.
 */
export async function assembleForecast(
  deps: Deps,
  workspaceId: string,
  scenarioId: string,
): Promise<ForecastResult> {
  const workspace = requireWorkspace(deps, workspaceId);
  const view = await loadWorkspace(deps, workspaceId);
  const historicalPeriods = view.periods;
  const latest = sortPeriodsMostRecentFirst(historicalPeriods)[0];
  const forecastPeriods = latest !== undefined ? extendAnnualPeriods(latest, workspace.forecastHorizon) : [];

  const driverRows = deps.db
    .select()
    .from(schema.drivers)
    .where(eq(schema.drivers.scenarioId, scenarioId))
    .all();

  const driverIndex = new Map(driverRows.map((r) => [`${r.key}::${r.periodKey}`, r]));

  const input: ForecastInput = {
    historicalPeriods,
    forecastPeriods,
    valueAt: (key, period) => view.cell(key, period).value,
    driverAt: (key, period) => driverIndex.get(`${key}::${period}`)?.value,
    driverBasisAt: (key, period) => {
      const basis = driverIndex.get(`${key}::${period}`)?.basis;
      return basis === "derived" || basis === "default" ? (basis as DriverBasis) : undefined;
    },
  };

  return runForecast(input);
}
