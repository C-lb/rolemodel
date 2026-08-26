import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { StoredDriverBasis } from "@/db/schema";
import { deriveDrivers, scenarioSeed, type SeededDriver } from "@/model/forecast/seed";
import { DRIVER_KEYS } from "@/model/forecast/drivers";
import { extendAnnualPeriods, sortPeriodsMostRecentFirst } from "@/model/periods";
import type { ActionResult, Deps } from "./documents";
import { loadWorkspace } from "./documents";
import { WorkspaceNotFoundError } from "./errors";

function failure(code: string, message: string, remediation: string): ActionResult<never> {
  return { ok: false, code, message, remediation };
}

export interface ScenarioRow {
  id: string;
  workspaceId: string;
  name: string;
  isBase: boolean;
  ordinal: number;
  createdAt: number;
}

export interface DriverRow {
  scenarioId: string;
  key: string;
  periodKey: string;
  value: number;
  basis: StoredDriverBasis;
  note: string;
  updatedAt: number;
}

function toScenarioRow(row: typeof schema.scenarios.$inferSelect): ScenarioRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    isBase: row.isBase === 1,
    ordinal: row.ordinal,
    createdAt: row.createdAt,
  };
}

export async function listScenarios(deps: Deps, workspaceId: string): Promise<ScenarioRow[]> {
  const rows = deps.db
    .select()
    .from(schema.scenarios)
    .where(eq(schema.scenarios.workspaceId, workspaceId))
    .all();
  return rows.sort((a, b) => a.ordinal - b.ordinal).map(toScenarioRow);
}

/**
 * The workspace row, or a `WorkspaceNotFoundError` — the same 404 boundary
 * `loadWorkspace` uses, so a scenario call against a workspace that does not exist
 * fails the same way every other call in this codebase does.
 */
function requireWorkspace(deps: Deps, workspaceId: string): typeof schema.workspaces.$inferSelect {
  const [row] = deps.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).all();
  if (!row) throw new WorkspaceNotFoundError(workspaceId);
  return row;
}

/**
 * The workspace's own historical facts and overrides, as a `SeedInput` for
 * `deriveDrivers` — the merged view `loadWorkspace` already builds, so a driver seeded
 * from history sees the same numbers the Statements tab shows, overrides included.
 */
async function historicalSeedInput(deps: Deps, workspaceId: string): Promise<{ periods: string[]; valueAt(key: string, period: string): number | undefined }> {
  const view = await loadWorkspace(deps, workspaceId);
  return {
    periods: view.periods,
    valueAt: (key: string, period: string) => view.cell(key, period).value,
  };
}

function latestPeriod(periods: string[]): string | undefined {
  return sortPeriodsMostRecentFirst(periods)[0];
}

/** Inserts one driver row per key in `keys`, for every period in `periods`. */
function insertDrivers(
  deps: Deps,
  scenarioId: string,
  periods: string[],
  seeded: SeededDriver[],
): void {
  const now = deps.now();
  for (const period of periods) {
    for (const driver of seeded) {
      deps.db.insert(schema.drivers).values({
        id: deps.newId(),
        scenarioId,
        key: driver.key,
        periodKey: period,
        value: driver.value,
        basis: driver.basis,
        note: driver.note,
        updatedAt: now,
      }).run();
    }
  }
}

const SCENARIO_KINDS: readonly { name: string; kind: "base" | "bull" | "bear" }[] = [
  { name: "Base", kind: "base" },
  { name: "Bull", kind: "bull" },
  { name: "Bear", kind: "bear" },
];

/**
 * Creates a scenario. The FIRST scenario ever created for a workspace seeds Base, Bull
 * and Bear together and makes Base active (spec §4.2, §9) — `name` is ignored in that
 * case, because there is no single name for a trio. Every later call adds one scenario
 * under `name`, with drivers derived fresh from the workspace's own history.
 */
export async function createScenario(
  deps: Deps,
  workspaceId: string,
  name: string,
): Promise<ActionResult<{ scenarioId: string }>> {
  requireWorkspace(deps, workspaceId);
  const existing = await listScenarios(deps, workspaceId);
  const seedInput = await historicalSeedInput(deps, workspaceId);
  const workspace = requireWorkspace(deps, workspaceId);
  const periods = extendAnnualPeriods(latestPeriod(seedInput.periods) ?? "", workspace.forecastHorizon);

  if (existing.length === 0) {
    const base = deriveDrivers(seedInput);
    let baseId = "";
    SCENARIO_KINDS.forEach(({ name: scenarioName, kind }, ordinal) => {
      const id = deps.newId();
      if (kind === "base") baseId = id;
      deps.db.insert(schema.scenarios).values({
        id, workspaceId, name: scenarioName, isBase: kind === "base" ? 1 : 0, ordinal, createdAt: deps.now(),
      }).run();
      insertDrivers(deps, id, periods, scenarioSeed(base, kind));
    });

    deps.db.update(schema.workspaces).set({ activeScenarioId: baseId }).where(eq(schema.workspaces.id, workspaceId)).run();
    return { ok: true, data: { scenarioId: baseId } };
  }

  const trimmed = name.trim();
  if (trimmed === "") {
    return failure("invalid_name", "A scenario needs a name.", "Give the scenario a short name.");
  }
  if (existing.some((s) => s.name === trimmed)) {
    return failure(
      "duplicate_name",
      `A scenario named "${trimmed}" already exists in this workspace.`,
      "Choose a different name.",
    );
  }

  const scenarioId = deps.newId();
  const ordinal = Math.max(...existing.map((s) => s.ordinal)) + 1;
  deps.db.insert(schema.scenarios).values({
    id: scenarioId, workspaceId, name: trimmed, isBase: 0, ordinal, createdAt: deps.now(),
  }).run();
  insertDrivers(deps, scenarioId, periods, deriveDrivers(seedInput));

  return { ok: true, data: { scenarioId } };
}

/**
 * Re-derives a scenario's drivers from the history AS IT STANDS NOW and overwrites
 * every row it holds, for the forecast periods the current history implies.
 *
 * Spec §4.1: "Re-seeding is an explicit user action that overwrites, never a silent
 * refresh." This is that action. It exists because driver rows are written once, at
 * scenario creation, against the forecast periods the then-latest historical year
 * implied — so uploading next year's filing into a workspace that already has
 * scenarios leaves the last forecast period with no driver rows at all. The engine
 * refuses that case (`forecast_drivers_missing`); this is how the user fixes it.
 *
 * It seeds the plain derived values, the same as `createScenario` does for any
 * scenario after the first trio. It does NOT re-apply §4.2's Bull and Bear nudges:
 * those are seeding-time starting points chosen to be obviously arbitrary, and there
 * is no privileged flag but `isBase` to read them back off a name (spec §2). A
 * re-seeded Bull is therefore a scenario the user must nudge again, which is why the
 * control says it overwrites and offers duplicating first.
 */
export async function reseedScenario(
  deps: Deps,
  workspaceId: string,
  scenarioId: string,
): Promise<ActionResult<{ periods: string[] }>> {
  const workspace = requireWorkspace(deps, workspaceId);
  const existing = await listScenarios(deps, workspaceId);
  if (!existing.some((s) => s.id === scenarioId)) {
    return failure("not_found", "No such scenario in this workspace.", "Reload the page and try again.");
  }

  const seedInput = await historicalSeedInput(deps, workspaceId);
  const latest = latestPeriod(seedInput.periods);
  const periods = extendAnnualPeriods(latest ?? "", workspace.forecastHorizon);
  if (periods.length === 0) {
    return failure(
      "not_forecastable",
      latest === undefined
        ? "This workspace has no historical periods to seed from."
        : `The most recent historical period is ${latest}, which is not a full year.`,
      "A forecast extends annual periods only. Add a full-year column to the workspace, then re-seed.",
    );
  }

  deps.db.delete(schema.drivers).where(eq(schema.drivers.scenarioId, scenarioId)).run();
  insertDrivers(deps, scenarioId, periods, deriveDrivers(seedInput));

  return { ok: true, data: { periods } };
}

export async function renameScenario(
  deps: Deps,
  workspaceId: string,
  scenarioId: string,
  name: string,
): Promise<ActionResult<null>> {
  const existing = await listScenarios(deps, workspaceId);
  const scenario = existing.find((s) => s.id === scenarioId);
  if (!scenario) {
    return failure("not_found", "No such scenario in this workspace.", "Reload the page and try again.");
  }

  const trimmed = name.trim();
  if (trimmed === "") {
    return failure("invalid_name", "A scenario needs a name.", "Give the scenario a short name.");
  }
  if (existing.some((s) => s.id !== scenarioId && s.name === trimmed)) {
    return failure(
      "duplicate_name",
      `A scenario named "${trimmed}" already exists in this workspace.`,
      "Choose a different name.",
    );
  }

  deps.db.update(schema.scenarios).set({ name: trimmed }).where(eq(schema.scenarios.id, scenarioId)).run();
  return { ok: true, data: null };
}

/** Copies a scenario's name (disambiguated) and every one of its driver rows. */
export async function duplicateScenario(
  deps: Deps,
  workspaceId: string,
  scenarioId: string,
  name: string,
): Promise<ActionResult<{ scenarioId: string }>> {
  const existing = await listScenarios(deps, workspaceId);
  const source = existing.find((s) => s.id === scenarioId);
  if (!source) {
    return failure("not_found", "No such scenario in this workspace.", "Reload the page and try again.");
  }

  const trimmed = name.trim();
  if (trimmed === "") {
    return failure("invalid_name", "A scenario needs a name.", "Give the scenario a short name.");
  }
  if (existing.some((s) => s.name === trimmed)) {
    return failure(
      "duplicate_name",
      `A scenario named "${trimmed}" already exists in this workspace.`,
      "Choose a different name.",
    );
  }

  const newId = deps.newId();
  const ordinal = Math.max(...existing.map((s) => s.ordinal)) + 1;
  deps.db.insert(schema.scenarios).values({
    id: newId, workspaceId, name: trimmed, isBase: 0, ordinal, createdAt: deps.now(),
  }).run();

  const sourceDrivers = deps.db.select().from(schema.drivers).where(eq(schema.drivers.scenarioId, scenarioId)).all();
  const now = deps.now();
  for (const row of sourceDrivers) {
    deps.db.insert(schema.drivers).values({
      id: deps.newId(),
      scenarioId: newId,
      key: row.key,
      periodKey: row.periodKey,
      value: row.value,
      basis: row.basis,
      note: row.note,
      updatedAt: now,
    }).run();
  }

  return { ok: true, data: { scenarioId: newId } };
}

/**
 * Deleting the base scenario is refused here, not by a database constraint, so the
 * refusal can carry a message (spec §9). Deleting a non-base scenario cascades its
 * drivers; if it was active, active moves to base.
 */
export async function deleteScenario(
  deps: Deps,
  workspaceId: string,
  scenarioId: string,
): Promise<ActionResult<null>> {
  const existing = await listScenarios(deps, workspaceId);
  const scenario = existing.find((s) => s.id === scenarioId);
  if (!scenario) {
    return failure("not_found", "No such scenario in this workspace.", "Reload the page and try again.");
  }
  if (scenario.isBase) {
    return failure(
      "base_scenario",
      "The base scenario cannot be deleted.",
      "Delete another scenario, or duplicate Base first if you want to experiment on a copy.",
    );
  }

  const workspace = requireWorkspace(deps, workspaceId);
  deps.db.delete(schema.scenarios).where(eq(schema.scenarios.id, scenarioId)).run();

  if (workspace.activeScenarioId === scenarioId) {
    const base = existing.find((s) => s.isBase);
    if (base) {
      deps.db.update(schema.workspaces).set({ activeScenarioId: base.id }).where(eq(schema.workspaces.id, workspaceId)).run();
    }
  }

  return { ok: true, data: null };
}

export async function setActiveScenario(
  deps: Deps,
  workspaceId: string,
  scenarioId: string,
): Promise<ActionResult<null>> {
  const existing = await listScenarios(deps, workspaceId);
  if (!existing.some((s) => s.id === scenarioId)) {
    return failure("not_found", "No such scenario in this workspace.", "Reload the page and try again.");
  }

  deps.db.update(schema.workspaces).set({ activeScenarioId: scenarioId }).where(eq(schema.workspaces.id, workspaceId)).run();
  return { ok: true, data: null };
}

export async function readDrivers(deps: Deps, scenarioId: string): Promise<DriverRow[]> {
  const rows = deps.db
    .select()
    .from(schema.drivers)
    .where(eq(schema.drivers.scenarioId, scenarioId))
    .orderBy(schema.drivers.key, schema.drivers.periodKey)
    .all();
  return rows.map((r) => ({
    scenarioId: r.scenarioId,
    key: r.key,
    periodKey: r.periodKey,
    value: r.value,
    basis: r.basis,
    note: r.note,
    updatedAt: r.updatedAt,
  }));
}

/** Upserts on `(scenarioId, key, periodKey)`. A manual edit is always `basis: "user"`. */
export async function saveDriver(
  deps: Deps,
  scenarioId: string,
  key: string,
  periodKey: string,
  value: number,
): Promise<ActionResult<null>> {
  if (!DRIVER_KEYS.includes(key)) {
    return failure("invalid_key", `"${key}" is not a forecast driver.`, "Choose one of the listed drivers.");
  }
  if (!Number.isFinite(value)) {
    return failure("invalid_value", "A driver needs a finite number.", "Enter a number.");
  }

  const where = and(
    eq(schema.drivers.scenarioId, scenarioId),
    eq(schema.drivers.key, key),
    eq(schema.drivers.periodKey, periodKey),
  );
  const [existing] = deps.db.select().from(schema.drivers).where(where).all();
  const now = deps.now();
  if (existing) {
    deps.db.update(schema.drivers).set({ value, basis: "user", note: "Entered directly.", updatedAt: now }).where(where).run();
  } else {
    deps.db.insert(schema.drivers).values({
      id: deps.newId(), scenarioId, key, periodKey, value, basis: "user", note: "Entered directly.", updatedAt: now,
    }).run();
  }

  return { ok: true, data: null };
}

/**
 * Copies `fromPeriod`'s value for `key` to every LATER forecast period of the same
 * scenario. Never touches `fromPeriod` itself or an earlier one.
 */
export async function fillRight(
  deps: Deps,
  scenarioId: string,
  key: string,
  fromPeriod: string,
): Promise<ActionResult<null>> {
  const rows = deps.db
    .select()
    .from(schema.drivers)
    .where(and(eq(schema.drivers.scenarioId, scenarioId), eq(schema.drivers.key, key)))
    .all();

  const source = rows.find((r) => r.periodKey === fromPeriod);
  if (!source) {
    return failure(
      "not_found",
      `No driver value for "${key}" at ${fromPeriod}.`,
      "Reload the page and try again.",
    );
  }

  const ranked = sortPeriodsMostRecentFirst(rows.map((r) => r.periodKey));
  const fromIndex = ranked.indexOf(fromPeriod);
  // `ranked` is most-recent-first, so every period AFTER `fromIndex` in that order is
  // chronologically EARLIER — the later periods `fillRight` must touch sit BEFORE it.
  const laterPeriods = ranked.slice(0, fromIndex);

  const now = deps.now();
  for (const period of laterPeriods) {
    const where = and(
      eq(schema.drivers.scenarioId, scenarioId),
      eq(schema.drivers.key, key),
      eq(schema.drivers.periodKey, period),
    );
    deps.db.update(schema.drivers).set({
      value: source.value,
      basis: "user",
      note: `Filled right from ${fromPeriod}.`,
      updatedAt: now,
    }).where(where).run();
  }

  return { ok: true, data: null };
}

export async function setForecastHorizon(
  deps: Deps,
  workspaceId: string,
  horizon: number,
): Promise<ActionResult<null>> {
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 5) {
    return failure(
      "invalid_horizon",
      "The forecast horizon must be a whole number of periods from 1 to 5.",
      "Choose a horizon between 1 and 5 years.",
    );
  }

  const workspace = requireWorkspace(deps, workspaceId);
  const oldHorizon = workspace.forecastHorizon;
  if (horizon === oldHorizon) return { ok: true, data: null };

  const seedInput = await historicalSeedInput(deps, workspaceId);
  const latest = latestPeriod(seedInput.periods);
  const oldPeriods = latest !== undefined ? extendAnnualPeriods(latest, oldHorizon) : [];
  const newPeriods = latest !== undefined ? extendAnnualPeriods(latest, horizon) : [];

  const scenarios = await listScenarios(deps, workspaceId);

  if (horizon > oldHorizon) {
    const addedPeriods = newPeriods.filter((p) => !oldPeriods.includes(p));
    const lastExistingPeriod = oldPeriods[oldPeriods.length - 1];
    if (addedPeriods.length > 0 && lastExistingPeriod !== undefined) {
      const now = deps.now();
      for (const scenario of scenarios) {
        const lastRows = deps.db
          .select()
          .from(schema.drivers)
          .where(and(eq(schema.drivers.scenarioId, scenario.id), eq(schema.drivers.periodKey, lastExistingPeriod)))
          .all();
        for (const period of addedPeriods) {
          for (const row of lastRows) {
            deps.db.insert(schema.drivers).values({
              id: deps.newId(),
              scenarioId: scenario.id,
              key: row.key,
              periodKey: period,
              value: row.value,
              basis: row.basis,
              note: row.note,
              updatedAt: now,
            }).run();
          }
        }
      }
    }
  } else {
    const removedPeriods = oldPeriods.filter((p) => !newPeriods.includes(p));
    for (const scenario of scenarios) {
      for (const period of removedPeriods) {
        deps.db.delete(schema.drivers)
          .where(and(eq(schema.drivers.scenarioId, scenario.id), eq(schema.drivers.periodKey, period)))
          .run();
      }
    }
  }

  deps.db.update(schema.workspaces).set({ forecastHorizon: horizon }).where(eq(schema.workspaces.id, workspaceId)).run();
  return { ok: true, data: null };
}
