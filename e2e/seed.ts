import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/db/schema";
import { migrate } from "../src/db/client";
import { FY2022, FY2023, FY2024 } from "../src/model/ratios/fixtures";

/**
 * Builds a workspace the browser tests can open, without an API key and without calling
 * the model: the figures are the same hand-checked fixture the unit tests use, so a
 * number that looks wrong in the browser is a UI fault, not an extraction one.
 */

export const WORKSPACE_ID = "e2e-workspace";
export const DOCUMENT_NAME = "acme-10-K.pdf";

const PROVENANCE = {
  page: 1,
  sheet: null,
  locator: "Consolidated statements, row 1",
  rawLabel: "Fixture line",
  rawValue: "1,000",
  scaleFactor: 1,
  scaleEvidence: "(in thousands)",
  signFlipped: false,
};

export function seed(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "finmodel.db");
  fs.rmSync(file, { force: true });

  const sqlite = new Database(file);
  const db = drizzle(sqlite, { schema });
  migrate(db);

  db.insert(schema.documents).values({
    id: "doc-1", filename: DOCUMENT_NAME, kind: "pdf", hash: "seed",
    sizeBytes: 1024, storagePath: path.join(dataDir, DOCUMENT_NAME), ingestedAt: 1,
  }).run();

  db.insert(schema.extractionRuns).values({
    id: "run-1", documentId: "doc-1", modelId: "claude-opus-5", promptVersion: 1,
    status: "complete", tokensIn: 0, tokensOut: 0, createdAt: 1, conflicts: [],
  }).run();

  const rows: [string, Record<string, number>][] = [
    ["FY2024", FY2024],
    ["FY2023", FY2023],
    ["FY2022", FY2022],
  ];

  let id = 0;
  for (const [periodKey, row] of rows) {
    for (const [canonicalKey, value] of Object.entries(row)) {
      db.insert(schema.facts).values({
        id: `fact-${(id += 1)}`,
        runId: "run-1",
        canonicalKey,
        periodKey,
        value,
        confidence: 0.95,
        provenance: PROVENANCE,
      }).run();
    }
  }

  db.insert(schema.workspaces).values({
    id: WORKSPACE_ID, name: DOCUMENT_NAME, activeRunId: "run-1",
    averagingMode: "ending", createdAt: 1,
  }).run();

  sqlite.close();
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed(process.env.DATA_DIR ?? "./data-e2e");
}
