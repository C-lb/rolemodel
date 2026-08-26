import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { migrate } from "./client";

function freshDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db);
  return db;
}

describe("schema", () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it("stores a document and reads it back", () => {
    db.insert(schema.documents).values({
      id: "doc1", filename: "10k.pdf", kind: "pdf", hash: "abc",
      sizeBytes: 100, storagePath: "/tmp/10k.pdf", ingestedAt: 1,
    }).run();
    const rows = db.select().from(schema.documents).where(eq(schema.documents.id, "doc1")).all();
    expect(rows[0].filename).toBe("10k.pdf");
  });

  it("round-trips provenance JSON on a fact", () => {
    db.insert(schema.documents).values({
      id: "doc1", filename: "a.pdf", kind: "pdf", hash: "h",
      sizeBytes: 1, storagePath: "/tmp/a.pdf", ingestedAt: 1,
    }).run();
    db.insert(schema.extractionRuns).values({
      id: "run1", documentId: "doc1", modelId: "claude-opus-5",
      promptVersion: 1, status: "complete", createdAt: 1,
    }).run();
    db.insert(schema.facts).values({
      id: "f1", runId: "run1", canonicalKey: "revenue", periodKey: "FY2024",
      value: 1000, confidence: 0.9,
      provenance: { page: 42, sheet: null, locator: "table-2-row-1", rawLabel: "Net revenue",
                    rawValue: "1,000", scaleFactor: 1000, scaleEvidence: "(in thousands)", signFlipped: false },
    }).run();
    const [fact] = db.select().from(schema.facts).all();
    expect(fact.provenance.page).toBe(42);
    expect(fact.provenance.scaleFactor).toBe(1000);
  });

  it("cascades fact deletion when its run is deleted", () => {
    db.insert(schema.documents).values({
      id: "doc1", filename: "a.pdf", kind: "pdf", hash: "h",
      sizeBytes: 1, storagePath: "/tmp/a.pdf", ingestedAt: 1,
    }).run();
    db.insert(schema.extractionRuns).values({
      id: "run1", documentId: "doc1", modelId: "claude-opus-5",
      promptVersion: 1, status: "complete", createdAt: 1,
    }).run();
    db.insert(schema.facts).values({
      id: "f1", runId: "run1", canonicalKey: "revenue", periodKey: "FY2024", value: 1, confidence: 1,
      provenance: { page: null, sheet: null, locator: "", rawLabel: "", rawValue: "",
                    scaleFactor: 1, scaleEvidence: "", signFlipped: false },
    }).run();
    db.delete(schema.extractionRuns).where(eq(schema.extractionRuns.id, "run1")).run();
    expect(db.select().from(schema.facts).all()).toHaveLength(0);
  });

  it("round-trips a non-empty conflicts array on a run, and defaults to [] when omitted", () => {
    db.insert(schema.documents).values({
      id: "doc1", filename: "a.pdf", kind: "pdf", hash: "h",
      sizeBytes: 1, storagePath: "/tmp/a.pdf", ingestedAt: 1,
    }).run();

    db.insert(schema.extractionRuns).values({
      id: "run1", documentId: "doc1", modelId: "claude-opus-5",
      promptVersion: 1, status: "complete", createdAt: 1,
      conflicts: [{
        canonicalKey: "revenue", periodKey: "FY2024",
        candidates: [
          { value: 1000, confidence: 0.9, provenance: { page: 1, sheet: null, locator: "a", rawLabel: "", rawValue: "", scaleFactor: 1, scaleEvidence: "", signFlipped: false } },
          { value: 1100, confidence: 0.7, provenance: { page: 2, sheet: null, locator: "b", rawLabel: "", rawValue: "", scaleFactor: 1, scaleEvidence: "", signFlipped: false } },
        ],
      }],
    }).run();

    db.insert(schema.extractionRuns).values({
      id: "run2", documentId: "doc1", modelId: "claude-opus-5",
      promptVersion: 1, status: "complete", createdAt: 2,
    }).run();

    const [runWithConflicts] = db.select().from(schema.extractionRuns).where(eq(schema.extractionRuns.id, "run1")).all();
    const [runWithoutConflicts] = db.select().from(schema.extractionRuns).where(eq(schema.extractionRuns.id, "run2")).all();

    expect(runWithConflicts.conflicts).toHaveLength(1);
    expect(runWithConflicts.conflicts[0].canonicalKey).toBe("revenue");
    expect(runWithConflicts.conflicts[0].candidates[1].value).toBe(1100);
    expect(runWithoutConflicts.conflicts).toEqual([]);
  });

  it("defaults a new workspace to a 5-period horizon and no active scenario", () => {
    db.insert(schema.workspaces).values({ id: "ws1", name: "ws1", createdAt: 1 }).run();
    const [ws] = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, "ws1")).all();
    expect(ws.forecastHorizon).toBe(5);
    expect(ws.activeScenarioId).toBeNull();
  });

  it("round-trips a scenario and cascades its drivers when the scenario is deleted", () => {
    db.insert(schema.workspaces).values({ id: "ws1", name: "ws1", createdAt: 1 }).run();
    db.insert(schema.scenarios).values({
      id: "sc1", workspaceId: "ws1", name: "Base", isBase: 1, ordinal: 0, createdAt: 1,
    }).run();
    db.insert(schema.drivers).values({
      id: "d1", scenarioId: "sc1", key: "revenue_growth", periodKey: "FY2025",
      value: 0.05, basis: "derived", note: "computed", updatedAt: 1,
    }).run();

    const [scenario] = db.select().from(schema.scenarios).where(eq(schema.scenarios.id, "sc1")).all();
    expect(scenario.name).toBe("Base");
    expect(scenario.isBase).toBe(1);

    db.delete(schema.scenarios).where(eq(schema.scenarios.id, "sc1")).run();
    expect(db.select().from(schema.drivers).all()).toHaveLength(0);
  });

  it("refuses two scenarios with the same name in one workspace but allows it across workspaces", () => {
    db.insert(schema.workspaces).values({ id: "ws1", name: "ws1", createdAt: 1 }).run();
    db.insert(schema.workspaces).values({ id: "ws2", name: "ws2", createdAt: 1 }).run();
    db.insert(schema.scenarios).values({ id: "sc1", workspaceId: "ws1", name: "Base", isBase: 1, ordinal: 0, createdAt: 1 }).run();
    expect(() =>
      db.insert(schema.scenarios).values({ id: "sc2", workspaceId: "ws1", name: "Base", isBase: 0, ordinal: 1, createdAt: 1 }).run(),
    ).toThrow();
    expect(() =>
      db.insert(schema.scenarios).values({ id: "sc3", workspaceId: "ws2", name: "Base", isBase: 1, ordinal: 0, createdAt: 1 }).run(),
    ).not.toThrow();
  });

  it("refuses two driver rows for the same scenario, key and period", () => {
    db.insert(schema.workspaces).values({ id: "ws1", name: "ws1", createdAt: 1 }).run();
    db.insert(schema.scenarios).values({ id: "sc1", workspaceId: "ws1", name: "Base", isBase: 1, ordinal: 0, createdAt: 1 }).run();
    db.insert(schema.drivers).values({
      id: "d1", scenarioId: "sc1", key: "revenue_growth", periodKey: "FY2025",
      value: 0.05, basis: "derived", note: "", updatedAt: 1,
    }).run();
    expect(() =>
      db.insert(schema.drivers).values({
        id: "d2", scenarioId: "sc1", key: "revenue_growth", periodKey: "FY2025",
        value: 0.06, basis: "user", note: "", updatedAt: 2,
      }).run(),
    ).toThrow();
  });
});

describe("migrating a database created before M3", () => {
  /** The M2 shape: workspaces has `averaging_mode` but none of M3's additions. */
  function m2Sqlite(): InstanceType<typeof Database> {
    const sqlite = new Database(":memory:");
    sqlite.exec(
      `CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL,
         active_run_id TEXT, averaging_mode TEXT NOT NULL DEFAULT 'average',
         created_at INTEGER NOT NULL)`,
    );
    sqlite.prepare(
      `INSERT INTO workspaces (id, name, averaging_mode, created_at) VALUES ('old', 'old', 'ending', 1)`,
    ).run();
    return sqlite;
  }

  it("adds forecast_horizon and active_scenario_id without damaging the existing row", () => {
    const sqlite = m2Sqlite();
    const db = drizzle(sqlite, { schema });
    migrate(db);

    const columns = sqlite.prepare(`PRAGMA table_info(workspaces)`).all() as { name: string }[];
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(["forecast_horizon", "active_scenario_id"]),
    );

    const row = sqlite.prepare(`SELECT * FROM workspaces WHERE id = 'old'`).get() as Record<string, unknown>;
    expect(row.name).toBe("old");
    expect(row.averaging_mode).toBe("ending");
    expect(row.forecast_horizon).toBe(5);
    expect(row.active_scenario_id).toBeNull();
  });

  it("creates the scenarios and drivers tables against a database that predates them", () => {
    const sqlite = m2Sqlite();
    const db = drizzle(sqlite, { schema });
    migrate(db);

    db.insert(schema.scenarios).values({
      id: "sc1", workspaceId: "old", name: "Base", isBase: 1, ordinal: 0, createdAt: 1,
    }).run();
    const [scenario] = db.select().from(schema.scenarios).all();
    expect(scenario.name).toBe("Base");
  });

  it("is a no-op the second time it runs against the same database", () => {
    const sqlite = m2Sqlite();
    const db = drizzle(sqlite, { schema });
    migrate(db);
    migrate(db);

    const row = sqlite.prepare(`SELECT * FROM workspaces WHERE id = 'old'`).get() as Record<string, unknown>;
    expect(row.forecast_horizon).toBe(5);

    db.insert(schema.scenarios).values({
      id: "sc1", workspaceId: "old", name: "Base", isBase: 1, ordinal: 0, createdAt: 1,
    }).run();
    expect(() => migrate(db)).not.toThrow();
    // The scenario inserted before the second migrate must survive it untouched.
    expect(db.select().from(schema.scenarios).all()).toHaveLength(1);
  });

  it("is a no-op the second time against a freshly created database", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite, { schema });
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
  });
});
