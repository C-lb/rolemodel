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
});
