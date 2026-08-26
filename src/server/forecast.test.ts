import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { migrate, type Db } from "@/db/client";
import type { Deps } from "./documents";
import { createScenario, listScenarios, saveDriver, readDrivers, reseedScenario } from "./scenarios";
import { assembleForecast } from "./forecast";
import { DRIVER_KEYS } from "@/model/forecast/drivers";

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
      throw new Error("forecast assembly must never call the model");
    },
    now: () => 1_700_000_000_000,
    newId: () => `id${(counter += 1)}`,
    writeFile: async () => {
      throw new Error("forecast assembly must never touch the filesystem");
    },
    dataDir: "/nowhere",
  };
}

/** A complete, self-balancing FY2024 history, closing exactly, for the annual case. */
const FY2024: Record<string, number> = {
  revenue: 1100, cost_of_revenue: -660, research_development: 55, selling_general_admin: 110,
  stock_based_compensation: 22, interest_expense: -20, pretax_income: 300, income_tax_expense: -60,
  cash_and_equivalents: 400, accounts_receivable: 110, inventory: 66, property_plant_equipment: 500,
  accounts_payable: 99, short_term_debt: 50, long_term_debt: 150, depreciation_amortisation: 50,
  capital_expenditures: -88, other_income_expense: 15, net_income: 210, dividends_paid: -42,
  debt_issued_repaid: -25, short_term_investments: 20, other_current_assets: 24, goodwill: 50,
  intangible_assets: 30, other_noncurrent_assets: 26, accrued_liabilities: 60,
  deferred_revenue_current: 40, other_current_liabilities: 21, other_noncurrent_liabilities: 80,
  common_stock_apic: 400, retained_earnings: 376, treasury_stock: -80, accumulated_oci: 30,
};

function insertFacts(db: Db, workspaceId: string, periodKey: string, values: Record<string, number>): void {
  let n = 0;
  for (const [canonicalKey, value] of Object.entries(values)) {
    db.insert(schema.facts).values({
      id: `${workspaceId}-${periodKey}-f${(n += 1)}`, runId: `${workspaceId}-run`, canonicalKey, periodKey, value,
      confidence: 0.9,
      provenance: { page: null, sheet: null, locator: "", rawLabel: canonicalKey, rawValue: String(value),
                    scaleFactor: 1, scaleEvidence: "", signFlipped: false },
    }).run();
  }
}

function makeAnnualWorkspace(db: Db, workspaceId: string): void {
  db.insert(schema.documents).values({
    id: `${workspaceId}-doc`, filename: "10k.pdf", kind: "pdf", hash: "h",
    sizeBytes: 1, storagePath: "/tmp/x.pdf", ingestedAt: 1,
  }).run();
  db.insert(schema.extractionRuns).values({
    id: `${workspaceId}-run`, documentId: `${workspaceId}-doc`, modelId: "claude-opus-5",
    promptVersion: 1, status: "complete", createdAt: 1,
  }).run();
  insertFacts(db, workspaceId, "FY2024", FY2024);
  db.insert(schema.workspaces).values({
    id: workspaceId, name: workspaceId, activeRunId: `${workspaceId}-run`, createdAt: 1,
  }).run();
}

function makeQuarterlyWorkspace(db: Db, workspaceId: string): void {
  db.insert(schema.documents).values({
    id: `${workspaceId}-doc`, filename: "10q.pdf", kind: "pdf", hash: "h",
    sizeBytes: 1, storagePath: "/tmp/x.pdf", ingestedAt: 1,
  }).run();
  db.insert(schema.extractionRuns).values({
    id: `${workspaceId}-run`, documentId: `${workspaceId}-doc`, modelId: "claude-opus-5",
    promptVersion: 1, status: "complete", createdAt: 1,
  }).run();
  insertFacts(db, workspaceId, "Q1-2025", { revenue: 300 });
  db.insert(schema.workspaces).values({
    id: workspaceId, name: workspaceId, activeRunId: `${workspaceId}-run`, createdAt: 1,
  }).run();
}

describe("assembleForecast", () => {
  let db: Db;
  let deps: Deps;

  beforeEach(() => {
    db = freshDb();
    deps = depsFor(db);
  });

  it("assembles a working forecast from a scenario's stored drivers", async () => {
    makeAnnualWorkspace(db, "ws1");
    const created = await createScenario(deps, "ws1", "ignored");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await assembleForecast(deps, "ws1", created.data.scenarioId);
    expect(result.ok).toBe(true);
    expect(result.findings.some((f) => f.severity === "blocking")).toBe(false);
    expect(result.valueAt("revenue", "FY2025")).toBeGreaterThan(0);
  });

  it("returns the engine's blocking finding, not a thrown error, when periods are quarterly", async () => {
    makeQuarterlyWorkspace(db, "ws1");
    // No scenario exists; assembleForecast must not need one to hit the quarterly gate,
    // and a nonexistent scenarioId must not make it throw either. The quarterly gate
    // runs before the driver-coverage gate, so this workspace is refused for the
    // reason a user would recognise rather than for having no drivers.
    const result = await assembleForecast(deps, "ws1", "no-such-scenario");

    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].code).toBe("forecast_not_annual");
    expect(result.findings[0].severity).toBe("blocking");
  });

  it("reflects a manually edited driver in the forecast output", async () => {
    makeAnnualWorkspace(db, "ws1");
    const created = await createScenario(deps, "ws1", "ignored");
    if (!created.ok) throw new Error("expected scenario creation to succeed");

    const rows = await readDrivers(deps, created.data.scenarioId);
    const period = [...new Set(rows.map((r) => r.periodKey))].sort()[0];
    await saveDriver(deps, created.data.scenarioId, "revenue_growth", period, 0.5);

    const result = await assembleForecast(deps, "ws1", created.data.scenarioId);
    expect(result.ok).toBe(true);
    expect(result.valueAt("revenue", period)).toBeCloseTo(1100 * 1.5, 6);
  });

  it("gives bull a higher forecast revenue than bear in the first forecast period", async () => {
    makeAnnualWorkspace(db, "ws1");
    await createScenario(deps, "ws1", "ignored");
    const scenarios = await listScenarios(deps, "ws1");
    const bull = scenarios.find((s) => s.name === "Bull")!;
    const bear = scenarios.find((s) => s.name === "Bear")!;

    const bullResult = await assembleForecast(deps, "ws1", bull.id);
    const bearResult = await assembleForecast(deps, "ws1", bear.id);
    expect(bullResult.ok).toBe(true);
    expect(bearResult.ok).toBe(true);

    const bullRows = await readDrivers(deps, bull.id);
    const period = [...new Set(bullRows.map((r) => r.periodKey))].sort()[0];
    expect(bullResult.valueAt("revenue", period)!).toBeGreaterThan(bearResult.valueAt("revenue", period)!);
  });

  it("flags a fallback-constant driver with forecast_driver_default, and clears it once every period is user-edited", async () => {
    makeAnnualWorkspace(db, "ws1");
    const created = await createScenario(deps, "ws1", "ignored");
    if (!created.ok) throw new Error("expected scenario creation to succeed");
    const scenarioId = created.data.scenarioId;

    // debt_repayment has no seeding rule that can ever derive it from history (seed.ts's
    // `alwaysDefault`), so every period on a freshly seeded scenario is `basis: "default"`.
    const seededRows = await readDrivers(deps, scenarioId);
    const debtRepaymentRows = seededRows.filter((r) => r.key === "debt_repayment");
    expect(debtRepaymentRows.length).toBeGreaterThan(0);
    expect(debtRepaymentRows.every((r) => r.basis === "default")).toBe(true);

    const before = await assembleForecast(deps, "ws1", scenarioId);
    expect(before.ok).toBe(true);
    const beforeFinding = before.findings.find((f) => f.code === "forecast_driver_default");
    expect(beforeFinding).toBeDefined();
    expect(beforeFinding!.keys).toContain("debt_repayment");

    // Overwrite every period's debt_repayment: saveDriver stamps basis "user", which
    // assembleForecast must map to a basis the engine never treats as "default".
    for (const period of debtRepaymentRows.map((r) => r.periodKey)) {
      const saved = await saveDriver(deps, scenarioId, "debt_repayment", period, 5);
      expect(saved.ok).toBe(true);
    }
    const editedRows = (await readDrivers(deps, scenarioId)).filter((r) => r.key === "debt_repayment");
    expect(editedRows.every((r) => r.basis === "user")).toBe(true);

    const after = await assembleForecast(deps, "ws1", scenarioId);
    expect(after.ok).toBe(true);
    const afterFinding = after.findings.find((f) => f.code === "forecast_driver_default");
    // interest_rate_cash is also an always-default driver and was left untouched, so the
    // finding as a whole may still fire — the assertion that matters is that the key we
    // edited is no longer named in it.
    if (afterFinding) {
      expect(afterFinding.keys).not.toContain("debt_repayment");
    }
  });
});

/**
 * THE CASE NOTHING COVERED, which is why it shipped.
 *
 * Driver rows are written once, at scenario creation, against the forecast periods the
 * then-latest historical year implied. `buildForecastInput` recomputes that list from
 * the CURRENT latest. Upload next year's filing into a workspace that already has
 * scenarios and the two lists come apart: the last forecast period has no driver rows
 * at all. Before the coverage gate the engine fell back to `DRIVER_DEFAULTS` for all
 * seventeen and returned ok, with a zero gross margin, and the driver grid rendered
 * `0.00%` for assumptions the engine had actually run at 0.03, 0.21 and 0.02.
 */
describe("a history that gains a period after its scenarios exist", () => {
  let db: Db;
  let deps: Deps;

  beforeEach(() => {
    db = freshDb();
    deps = depsFor(db);
  });

  /** FY2024 history, a five-year Base, then FY2025 actuals land. */
  async function withLaterActuals(): Promise<string> {
    makeAnnualWorkspace(db, "ws1");
    const created = await createScenario(deps, "ws1", "ignored");
    if (!created.ok) throw new Error("expected scenario creation to succeed");

    const before = await readDrivers(deps, created.data.scenarioId);
    expect([...new Set(before.map((r) => r.periodKey))].sort())
      .toEqual(["FY2025", "FY2026", "FY2027", "FY2028", "FY2029"]);

    insertFacts(db, "ws1", "FY2025", FY2024);
    return created.data.scenarioId;
  }

  it("refuses the forecast by name rather than quietly running on defaults", async () => {
    const scenarioId = await withLaterActuals();

    const result = await assembleForecast(deps, "ws1", scenarioId);
    expect(result.ok).toBe(false);
    expect(result.cells).toEqual([]);

    const finding = result.findings.find((f) => f.code === "forecast_drivers_missing");
    expect(finding, result.findings.map((f) => f.code).join(", ")).toBeDefined();
    expect(finding!.severity).toBe("blocking");
    // FY2026..FY2030 is the list now; only FY2030 was never seeded.
    expect(finding!.periodKey).toBe("FY2030");
    expect(finding!.keys).toEqual([...DRIVER_KEYS]);
    // And it points at the fix rather than at the engine.
    expect(finding!.remediation).toMatch(/re-seed/i);
  });

  it("re-seeding overwrites the scenario against the current history and unblocks it", async () => {
    const scenarioId = await withLaterActuals();

    const reseeded = await reseedScenario(deps, "ws1", scenarioId);
    expect(reseeded.ok).toBe(true);
    if (!reseeded.ok) return;
    expect(reseeded.data.periods).toEqual(["FY2026", "FY2027", "FY2028", "FY2029", "FY2030"]);

    // Overwritten, not merged: the rows for FY2025, now a historical period, are gone.
    const rows = await readDrivers(deps, scenarioId);
    expect([...new Set(rows.map((r) => r.periodKey))].sort()).toEqual(reseeded.data.periods);
    for (const period of reseeded.data.periods) {
      expect(rows.filter((r) => r.periodKey === period).map((r) => r.key).sort())
        .toEqual([...DRIVER_KEYS].sort());
    }

    const result = await assembleForecast(deps, "ws1", scenarioId);
    expect(result.ok, result.findings.map((f) => f.message).join("; ")).toBe(true);
    expect(result.findings.some((f) => f.code === "forecast_drivers_missing")).toBe(false);
    // A real forecast, opening from the new last actual rather than the old one.
    expect(result.valueAt("revenue", "FY2026")).toBeGreaterThan(0);
    expect(result.valueAt("gross_profit", "FY2026")).toBeGreaterThan(0);
  });

  it("re-seeding a scenario that is not in the workspace is refused, not thrown", async () => {
    makeAnnualWorkspace(db, "ws1");
    const result = await reseedScenario(deps, "ws1", "no-such-scenario");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_found");
  });

  it("refuses to re-seed a workspace whose latest period is not a full year", async () => {
    makeQuarterlyWorkspace(db, "ws1");
    db.insert(schema.scenarios).values({
      id: "s1", workspaceId: "ws1", name: "Base", isBase: 1, ordinal: 0, createdAt: 1,
    }).run();
    const result = await reseedScenario(deps, "ws1", "s1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_forecastable");
    expect(result.message).toContain("Q1-2025");
  });
});
