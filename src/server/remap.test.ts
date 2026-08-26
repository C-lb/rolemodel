import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { migrate } from "@/db/client";
import { remapFact } from "./remap";

function setup() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db);
  db.insert(schema.documents).values({
    id: "d", filename: "a.pdf", kind: "pdf", hash: "h", sizeBytes: 1, storagePath: "/tmp/a", ingestedAt: 1,
  }).run();
  db.insert(schema.extractionRuns).values({
    id: "r", documentId: "d", modelId: "claude-opus-5", promptVersion: 1, status: "complete", createdAt: 1,
  }).run();
  db.insert(schema.facts).values({
    id: "f", runId: "r", canonicalKey: "unmapped", periodKey: "FY2024", value: 42, confidence: 0.5,
    provenance: {
      page: 7, sheet: null, locator: "row 9", rawLabel: "Deferred revenue",
      rawValue: "42", scaleFactor: 1, scaleEvidence: "", signFlipped: false,
    },
  }).run();
  return { db, call: vi.fn(), now: () => 2, newId: () => "n", writeFile: async () => {}, dataDir: "/tmp" };
}

describe("remapFact", () => {
  it("moves a fact to a new canonical key and keeps its provenance", async () => {
    const deps = setup();
    await remapFact(deps, "f", "deferred_revenue_current");
    const [fact] = deps.db.select().from(schema.facts).all();
    expect(fact.canonicalKey).toBe("deferred_revenue_current");
    expect(fact.provenance.rawLabel).toBe("Deferred revenue");
    expect(fact.provenance.page).toBe(7);
  });

  it("refuses a key that is not in the taxonomy", async () => {
    const deps = setup();
    await expect(remapFact(deps, "f", "invented_key")).rejects.toThrow(/invented_key/);
  });

  it("refuses when the target key and period already hold a fact", async () => {
    const deps = setup();
    deps.db.insert(schema.facts).values({
      id: "f2", runId: "r", canonicalKey: "inventory", periodKey: "FY2024", value: 1, confidence: 1,
      provenance: {
        page: 1, sheet: null, locator: "", rawLabel: "Inventory", rawValue: "1",
        scaleFactor: 1, scaleEvidence: "", signFlipped: false,
      },
    }).run();
    await expect(remapFact(deps, "f", "inventory")).rejects.toThrow(/already/i);
  });

  it("refuses an unknown fact id", async () => {
    const deps = setup();
    await expect(remapFact(deps, "nope", "inventory")).rejects.toThrow(/nope/);
  });

  it("moves a fact back to unmapped, which is how a remap is undone", async () => {
    const deps = setup();
    await remapFact(deps, "f", "inventory");
    await remapFact(deps, "f", "unmapped");
    const [fact] = deps.db.select().from(schema.facts).all();
    expect(fact.canonicalKey).toBe("unmapped");
    expect(fact.provenance.rawLabel).toBe("Deferred revenue");
  });

  it("does not treat a second unmapped fact in the same period as a clash", async () => {
    const deps = setup();
    deps.db.insert(schema.facts).values({
      id: "f2", runId: "r", canonicalKey: "unmapped", periodKey: "FY2024", value: 7, confidence: 0.5,
      provenance: {
        page: 2, sheet: null, locator: "", rawLabel: "Other odd line", rawValue: "7",
        scaleFactor: 1, scaleEvidence: "", signFlipped: false,
      },
    }).run();
    await remapFact(deps, "f", "inventory");
    await expect(remapFact(deps, "f", "unmapped")).resolves.toBeUndefined();
  });

  it("leaves a fact in another run alone when it holds the target key and period", async () => {
    const deps = setup();
    deps.db.insert(schema.extractionRuns).values({
      id: "r2", documentId: "d", modelId: "claude-opus-5", promptVersion: 1, status: "complete", createdAt: 1,
    }).run();
    deps.db.insert(schema.facts).values({
      id: "f3", runId: "r2", canonicalKey: "inventory", periodKey: "FY2024", value: 9, confidence: 1,
      provenance: {
        page: 1, sheet: null, locator: "", rawLabel: "Inventory", rawValue: "9",
        scaleFactor: 1, scaleEvidence: "", signFlipped: false,
      },
    }).run();
    await remapFact(deps, "f", "inventory");
    const moved = deps.db.select().from(schema.facts).all().find((f) => f.id === "f");
    expect(moved?.canonicalKey).toBe("inventory");
  });
});
