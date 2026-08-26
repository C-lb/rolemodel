import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { migrate, type Db } from "@/db/client";
import { DRIVER_KEYS } from "@/model/forecast/drivers";
import type { Deps } from "./documents";
import {
  listScenarios,
  createScenario,
  renameScenario,
  duplicateScenario,
  deleteScenario,
  setActiveScenario,
  readDrivers,
  saveDriver,
  fillRight,
  setForecastHorizon,
} from "./scenarios";

function freshDb(): Db {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db);
  return db;
}

let counter = 0;

function depsFor(db: Db): Deps {
  return {
    db,
    call: async () => {
      throw new Error("scenarios must never call the model");
    },
    now: () => 1_700_000_000_000,
    newId: () => `id${(counter += 1)}`,
    writeFile: async () => {
      throw new Error("scenarios must never touch the filesystem");
    },
    dataDir: "/nowhere",
  };
}

/**
 * A workspace with two full years of history behind it, run through a real
 * extraction run so `loadWorkspace`'s merge logic (which `createScenario` relies on
 * for seeding) has something real to read. Values are chosen so every derivable
 * driver in `deriveDrivers` gets a `derived` basis, not a fallback.
 */
function makeWorkspaceWithHistory(db: Db, workspaceId: string): void {
  db.insert(schema.documents).values({
    id: `${workspaceId}-doc`, filename: "10k.pdf", kind: "pdf", hash: "h",
    sizeBytes: 1, storagePath: "/tmp/x.pdf", ingestedAt: 1,
  }).run();
  db.insert(schema.extractionRuns).values({
    id: `${workspaceId}-run`, documentId: `${workspaceId}-doc`, modelId: "claude-opus-5",
    promptVersion: 1, status: "complete", createdAt: 1,
  }).run();

  const rows: Record<string, Record<string, number>> = {
    FY2023: {
      revenue: 1000, cost_of_revenue: -600, research_development: 50, selling_general_admin: 100,
      stock_based_compensation: 20, interest_expense: -18, pretax_income: 270, income_tax_expense: -54,
      cash_and_equivalents: 360, accounts_receivable: 100, inventory: 60, property_plant_equipment: 460,
      accounts_payable: 90, short_term_debt: 45, long_term_debt: 135, depreciation_amortisation: 45,
      capital_expenditures: -80, other_income_expense: 12, net_income: 180, dividends_paid: -36,
      debt_issued_repaid: -20,
    },
    FY2024: {
      revenue: 1100, cost_of_revenue: -660, research_development: 55, selling_general_admin: 110,
      stock_based_compensation: 22, interest_expense: -20, pretax_income: 300, income_tax_expense: -60,
      cash_and_equivalents: 400, accounts_receivable: 110, inventory: 66, property_plant_equipment: 500,
      accounts_payable: 99, short_term_debt: 50, long_term_debt: 150, depreciation_amortisation: 50,
      capital_expenditures: -88, other_income_expense: 15, net_income: 210, dividends_paid: -42,
      debt_issued_repaid: -25, short_term_investments: 20, other_current_assets: 24, goodwill: 50,
      intangible_assets: 30, other_noncurrent_assets: 26, accrued_liabilities: 60,
      deferred_revenue_current: 40, other_current_liabilities: 21, other_noncurrent_liabilities: 80,
      common_stock_apic: 400, retained_earnings: 376, treasury_stock: -80, accumulated_oci: 30,
    },
  };

  let n = 0;
  for (const [periodKey, values] of Object.entries(rows)) {
    for (const [canonicalKey, value] of Object.entries(values)) {
      db.insert(schema.facts).values({
        id: `${workspaceId}-f${(n += 1)}`, runId: `${workspaceId}-run`, canonicalKey, periodKey, value,
        confidence: 0.9,
        provenance: { page: null, sheet: null, locator: "", rawLabel: canonicalKey, rawValue: String(value),
                      scaleFactor: 1, scaleEvidence: "", signFlipped: false },
      }).run();
    }
  }

  db.insert(schema.workspaces).values({
    id: workspaceId, name: workspaceId, activeRunId: `${workspaceId}-run`, createdAt: 1,
  }).run();
}

describe("scenario CRUD", () => {
  let db: Db;
  let deps: Deps;

  beforeEach(() => {
    db = freshDb();
    deps = depsFor(db);
    makeWorkspaceWithHistory(db, "ws1");
    makeWorkspaceWithHistory(db, "ws2");
  });

  it("seeds Base, Bull and Bear together on the first creation, and makes Base active", async () => {
    const created = await createScenario(deps, "ws1", "ignored");
    expect(created.ok).toBe(true);

    const scenarios = await listScenarios(deps, "ws1");
    expect(scenarios.map((s) => s.name).sort()).toEqual(["Base", "Bear", "Bull"]);
    expect(scenarios.filter((s) => s.isBase)).toHaveLength(1);
    expect(scenarios.find((s) => s.isBase)?.name).toBe("Base");

    const [ws] = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, "ws1")).all();
    const base = scenarios.find((s) => s.isBase);
    expect(ws.activeScenarioId).toBe(base?.id);
  });

  it("gives every driver a row for every forecast period, on every scenario in the trio", async () => {
    await createScenario(deps, "ws1", "ignored");
    const [ws] = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, "ws1")).all();
    const scenarios = await listScenarios(deps, "ws1");

    for (const scenario of scenarios) {
      const rows = await readDrivers(deps, scenario.id);
      expect(rows).toHaveLength(DRIVER_KEYS.length * ws.forecastHorizon);
      for (const key of DRIVER_KEYS) {
        const forKey = rows.filter((r) => r.key === key);
        expect(forKey).toHaveLength(ws.forecastHorizon);
        expect(forKey.every((r) => typeof r.note === "string" && r.note.length > 0)).toBe(true);
        expect(forKey.every((r) => r.basis === "derived" || r.basis === "default")).toBe(true);
      }
    }
  });

  it("nudges bull and bear off base by the documented steps", async () => {
    await createScenario(deps, "ws1", "ignored");
    const scenarios = await listScenarios(deps, "ws1");
    const base = scenarios.find((s) => s.name === "Base")!;
    const bull = scenarios.find((s) => s.name === "Bull")!;
    const bear = scenarios.find((s) => s.name === "Bear")!;

    const baseDrivers = await readDrivers(deps, base.id);
    const bullDrivers = await readDrivers(deps, bull.id);
    const bearDrivers = await readDrivers(deps, bear.id);

    const period = baseDrivers[0].periodKey;
    const baseGrowth = baseDrivers.find((d) => d.key === "revenue_growth" && d.periodKey === period)!.value;
    const bullGrowth = bullDrivers.find((d) => d.key === "revenue_growth" && d.periodKey === period)!.value;
    const bearGrowth = bearDrivers.find((d) => d.key === "revenue_growth" && d.periodKey === period)!.value;
    expect(bullGrowth).toBeCloseTo(baseGrowth + 0.03, 10);
    expect(bearGrowth).toBeCloseTo(baseGrowth - 0.03, 10);
  });

  it("adds a second scenario by name once the trio exists", async () => {
    await createScenario(deps, "ws1", "ignored");
    const added = await createScenario(deps, "ws1", "Downside case");
    expect(added.ok).toBe(true);

    const scenarios = await listScenarios(deps, "ws1");
    expect(scenarios.map((s) => s.name)).toContain("Downside case");
    expect(scenarios).toHaveLength(4);
  });

  it("refuses a duplicate name within a workspace but allows it in a different workspace", async () => {
    await createScenario(deps, "ws1", "ignored");
    await createScenario(deps, "ws2", "ignored");

    const first = await createScenario(deps, "ws1", "Downside case");
    expect(first.ok).toBe(true);
    const dup = await createScenario(deps, "ws1", "Downside case");
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.code).toBe("duplicate_name");

    const otherWorkspace = await createScenario(deps, "ws2", "Downside case");
    expect(otherWorkspace.ok).toBe(true);
  });

  it("rejects a blank name for an explicit creation", async () => {
    await createScenario(deps, "ws1", "ignored");
    const result = await createScenario(deps, "ws1", "   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_name");
  });

  it("renames a scenario, refusing a collision", async () => {
    await createScenario(deps, "ws1", "ignored");
    const scenarios = await listScenarios(deps, "ws1");
    const bull = scenarios.find((s) => s.name === "Bull")!;

    const renamed = await renameScenario(deps, "ws1", bull.id, "Optimistic");
    expect(renamed.ok).toBe(true);
    expect((await listScenarios(deps, "ws1")).map((s) => s.name)).toContain("Optimistic");

    const collision = await renameScenario(deps, "ws1", bull.id, "Base");
    expect(collision.ok).toBe(false);
    if (collision.ok) return;
    expect(collision.code).toBe("duplicate_name");
  });

  it("duplicates a scenario and its driver rows", async () => {
    await createScenario(deps, "ws1", "ignored");
    const scenarios = await listScenarios(deps, "ws1");
    const bull = scenarios.find((s) => s.name === "Bull")!;
    const bullDrivers = await readDrivers(deps, bull.id);

    const duplicated = await duplicateScenario(deps, "ws1", bull.id, "Bull copy");
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;

    const copyDrivers = await readDrivers(deps, duplicated.data.scenarioId);
    expect(copyDrivers).toHaveLength(bullDrivers.length);
    const originalGrowth = bullDrivers.find((d) => d.key === "revenue_growth")!.value;
    const copyGrowth = copyDrivers.find((d) => d.key === "revenue_growth")!.value;
    expect(copyGrowth).toBe(originalGrowth);
  });

  it("refuses to delete the base scenario, with a message", async () => {
    await createScenario(deps, "ws1", "ignored");
    const scenarios = await listScenarios(deps, "ws1");
    const base = scenarios.find((s) => s.isBase)!;

    const result = await deleteScenario(deps, "ws1", base.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("base_scenario");
    expect(result.message.length).toBeGreaterThan(0);
    expect(await listScenarios(deps, "ws1")).toHaveLength(3);
  });

  it("deletes a non-base scenario and cascades its drivers", async () => {
    await createScenario(deps, "ws1", "ignored");
    const scenarios = await listScenarios(deps, "ws1");
    const bear = scenarios.find((s) => s.name === "Bear")!;

    const result = await deleteScenario(deps, "ws1", bear.id);
    expect(result.ok).toBe(true);
    expect(await listScenarios(deps, "ws1")).toHaveLength(2);
    expect(db.select().from(schema.drivers).where(eq(schema.drivers.scenarioId, bear.id)).all()).toHaveLength(0);
  });

  it("moves active to base when the active scenario is deleted", async () => {
    await createScenario(deps, "ws1", "ignored");
    const scenarios = await listScenarios(deps, "ws1");
    const base = scenarios.find((s) => s.isBase)!;
    const bull = scenarios.find((s) => s.name === "Bull")!;

    await setActiveScenario(deps, "ws1", bull.id);
    const deleted = await deleteScenario(deps, "ws1", bull.id);
    expect(deleted.ok).toBe(true);

    const [ws] = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, "ws1")).all();
    expect(ws.activeScenarioId).toBe(base.id);
  });

  it("sets the active scenario", async () => {
    await createScenario(deps, "ws1", "ignored");
    const scenarios = await listScenarios(deps, "ws1");
    const bear = scenarios.find((s) => s.name === "Bear")!;

    const result = await setActiveScenario(deps, "ws1", bear.id);
    expect(result.ok).toBe(true);
    const [ws] = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, "ws1")).all();
    expect(ws.activeScenarioId).toBe(bear.id);
  });
});

describe("driver upsert and fillRight", () => {
  let db: Db;
  let deps: Deps;
  let baseId: string;
  let periods: string[];

  beforeEach(async () => {
    db = freshDb();
    deps = depsFor(db);
    makeWorkspaceWithHistory(db, "ws1");
    await createScenario(deps, "ws1", "ignored");
    const scenarios = await listScenarios(deps, "ws1");
    baseId = scenarios.find((s) => s.isBase)!.id;
    const rows = await readDrivers(deps, baseId);
    periods = [...new Set(rows.map((r) => r.periodKey))].sort();
  });

  it("is idempotent on (scenarioId, key, periodKey): a second save updates, not duplicates", async () => {
    const period = periods[0];
    const first = await saveDriver(deps, baseId, "revenue_growth", period, 0.10);
    expect(first.ok).toBe(true);
    const second = await saveDriver(deps, baseId, "revenue_growth", period, 0.12);
    expect(second.ok).toBe(true);

    const rows = await readDrivers(deps, baseId);
    const matching = rows.filter((r) => r.key === "revenue_growth" && r.periodKey === period);
    expect(matching).toHaveLength(1);
    expect(matching[0].value).toBe(0.12);
    expect(matching[0].basis).toBe("user");
  });

  it("rejects an unknown driver key", async () => {
    const result = await saveDriver(deps, baseId, "not_a_driver", periods[0], 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_key");
  });

  it("fillRight copies to every later period and touches no earlier one", async () => {
    expect(periods.length).toBeGreaterThanOrEqual(3);
    const [p1, p2, p3] = periods;

    await saveDriver(deps, baseId, "gross_margin", p1, 0.11);
    await saveDriver(deps, baseId, "gross_margin", p2, 0.50);
    await saveDriver(deps, baseId, "gross_margin", p3, 0.60);

    const result = await fillRight(deps, baseId, "gross_margin", p1);
    expect(result.ok).toBe(true);

    const rows = await readDrivers(deps, baseId);
    const forKey = new Map(rows.filter((r) => r.key === "gross_margin").map((r) => [r.periodKey, r.value]));
    expect(forKey.get(p1)).toBe(0.11);
    expect(forKey.get(p2)).toBe(0.11);
    expect(forKey.get(p3)).toBe(0.11);
  });

  it("fillRight from the middle leaves earlier periods untouched", async () => {
    const [p1, p2, p3] = periods;
    await saveDriver(deps, baseId, "tax_rate", p1, 0.10);
    await saveDriver(deps, baseId, "tax_rate", p2, 0.20);
    await saveDriver(deps, baseId, "tax_rate", p3, 0.30);

    await fillRight(deps, baseId, "tax_rate", p2);

    const rows = await readDrivers(deps, baseId);
    const forKey = new Map(rows.filter((r) => r.key === "tax_rate").map((r) => [r.periodKey, r.value]));
    expect(forKey.get(p1)).toBe(0.10);
    expect(forKey.get(p2)).toBe(0.20);
    expect(forKey.get(p3)).toBe(0.20);
  });
});

describe("forecast horizon changes", () => {
  let db: Db;
  let deps: Deps;

  beforeEach(() => {
    db = freshDb();
    deps = depsFor(db);
    makeWorkspaceWithHistory(db, "ws1");
  });

  it("seeds new periods from the last existing forecast period, for every scenario", async () => {
    await setForecastHorizon(deps, "ws1", 3);
    await createScenario(deps, "ws1", "ignored");
    const scenarios = await listScenarios(deps, "ws1");

    // Edit the last existing period's revenue_growth on Base and Bull, distinctly, so
    // seeding-from-last-period is provably per-scenario rather than copied from one.
    const base = scenarios.find((s) => s.isBase)!;
    const bull = scenarios.find((s) => s.name === "Bull")!;
    const baseRows = await readDrivers(deps, base.id);
    const lastPeriod = [...new Set(baseRows.map((r) => r.periodKey))].sort().at(-1)!;
    await saveDriver(deps, base.id, "revenue_growth", lastPeriod, 0.42);
    await saveDriver(deps, bull.id, "revenue_growth", lastPeriod, 0.55);

    const result = await setForecastHorizon(deps, "ws1", 5);
    expect(result.ok).toBe(true);

    for (const [scenario, expected] of [[base, 0.42], [bull, 0.55]] as const) {
      const rows = await readDrivers(deps, scenario.id);
      const periods = [...new Set(rows.map((r) => r.periodKey))];
      expect(periods).toHaveLength(5);
      const newPeriods = periods.filter((p) => !baseRows.some((r) => r.periodKey === p));
      expect(newPeriods.length).toBe(2);
      for (const p of newPeriods) {
        expect(rows.find((r) => r.key === "revenue_growth" && r.periodKey === p)?.value).toBe(expected);
      }
    }

    const [ws] = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, "ws1")).all();
    expect(ws.forecastHorizon).toBe(5);
  });

  it("deletes driver rows beyond the new horizon and leaves the rest untouched", async () => {
    await setForecastHorizon(deps, "ws1", 5);
    await createScenario(deps, "ws1", "ignored");
    const scenarios = await listScenarios(deps, "ws1");
    const base = scenarios.find((s) => s.isBase)!;
    const before = await readDrivers(deps, base.id);
    const periodsBefore = [...new Set(before.map((r) => r.periodKey))].sort();

    const result = await setForecastHorizon(deps, "ws1", 2);
    expect(result.ok).toBe(true);

    const after = await readDrivers(deps, base.id);
    const periodsAfter = new Set(after.map((r) => r.periodKey));
    expect(periodsAfter.size).toBe(2);
    for (const p of periodsBefore.slice(0, 2)) expect(periodsAfter.has(p)).toBe(true);
    for (const p of periodsBefore.slice(2)) expect(periodsAfter.has(p)).toBe(false);
  });

  it("rejects a horizon outside 1-5", async () => {
    const result = await setForecastHorizon(deps, "ws1", 6);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_horizon");
  });

  it("is a no-op when the horizon does not change", async () => {
    await createScenario(deps, "ws1", "ignored");
    const before = await listScenarios(deps, "ws1");
    const baseId = before.find((s) => s.isBase)!.id;
    const driversBefore = await readDrivers(deps, baseId);

    const result = await setForecastHorizon(deps, "ws1", 5);
    expect(result.ok).toBe(true);
    expect(await readDrivers(deps, baseId)).toHaveLength(driversBefore.length);
  });
});
