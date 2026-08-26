import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const DDL = [
  `CREATE TABLE IF NOT EXISTS documents (
     id TEXT PRIMARY KEY, filename TEXT NOT NULL, kind TEXT NOT NULL, hash TEXT NOT NULL,
     size_bytes INTEGER NOT NULL, storage_path TEXT NOT NULL, ingested_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS extraction_runs (
     id TEXT PRIMARY KEY,
     document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     model_id TEXT NOT NULL, prompt_version INTEGER NOT NULL, status TEXT NOT NULL,
     error TEXT, tokens_in INTEGER, tokens_out INTEGER, created_at INTEGER NOT NULL,
     conflicts TEXT NOT NULL DEFAULT '[]')`,
  `CREATE TABLE IF NOT EXISTS facts (
     id TEXT PRIMARY KEY,
     run_id TEXT NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
     canonical_key TEXT NOT NULL, period_key TEXT NOT NULL, value REAL NOT NULL,
     confidence REAL NOT NULL, provenance TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS facts_by_run ON facts(run_id)`,
  `CREATE INDEX IF NOT EXISTS facts_by_key ON facts(canonical_key, period_key)`,
  `CREATE TABLE IF NOT EXISTS workspaces (
     id TEXT PRIMARY KEY, name TEXT NOT NULL,
     active_run_id TEXT REFERENCES extraction_runs(id) ON DELETE SET NULL,
     averaging_mode TEXT NOT NULL DEFAULT 'average',
     created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS overrides (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     canonical_key TEXT NOT NULL, period_key TEXT NOT NULL, value REAL NOT NULL,
     note TEXT, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS overrides_by_workspace ON overrides(workspace_id)`,
  `CREATE TABLE IF NOT EXISTS custom_ratios (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     key TEXT NOT NULL, label TEXT NOT NULL, expression TEXT NOT NULL, note TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS custom_ratios_key ON custom_ratios(workspace_id, key)`,
  `CREATE INDEX IF NOT EXISTS custom_ratios_by_workspace ON custom_ratios(workspace_id)`,
  `CREATE TABLE IF NOT EXISTS interpretations (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     ratio_key TEXT NOT NULL, input_hash TEXT NOT NULL, text TEXT NOT NULL,
     declined INTEGER NOT NULL, reason TEXT, model_id TEXT NOT NULL,
     prompt_version INTEGER NOT NULL, tokens_in INTEGER, tokens_out INTEGER,
     created_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS interpretations_key ON interpretations(workspace_id, ratio_key, input_hash)`,
  `CREATE INDEX IF NOT EXISTS interpretations_by_workspace ON interpretations(workspace_id)`,
  `CREATE TABLE IF NOT EXISTS scenarios (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     name TEXT NOT NULL, is_base INTEGER NOT NULL DEFAULT 0, ordinal INTEGER NOT NULL,
     created_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS scenarios_unique_name ON scenarios(workspace_id, name)`,
  `CREATE INDEX IF NOT EXISTS scenarios_by_workspace ON scenarios(workspace_id)`,
  `CREATE TABLE IF NOT EXISTS drivers (
     id TEXT PRIMARY KEY,
     scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
     key TEXT NOT NULL, period_key TEXT NOT NULL, value REAL NOT NULL,
     basis TEXT NOT NULL CHECK (basis IN ('derived', 'default', 'user')),
     note TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS drivers_unique_cell ON drivers(scenario_id, key, period_key)`,
  `CREATE INDEX IF NOT EXISTS drivers_by_scenario ON drivers(scenario_id)`,
];

/**
 * Columns added to tables that already exist in the field. `CREATE TABLE IF NOT EXISTS`
 * is a no-op against a database created by an earlier version, so a new column has to be
 * added explicitly, and only when it is absent: SQLite has no `ADD COLUMN IF NOT EXISTS`.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: "workspaces", column: "averaging_mode", definition: "TEXT NOT NULL DEFAULT 'average'" },
  { table: "workspaces", column: "forecast_horizon", definition: "INTEGER NOT NULL DEFAULT 5" },
  { table: "workspaces", column: "active_scenario_id", definition: "TEXT REFERENCES scenarios(id) ON DELETE SET NULL" },
];

export function migrate(db: Db): void {
  db.run(sql`PRAGMA foreign_keys = ON`);
  for (const statement of DDL) db.run(sql.raw(statement));

  for (const { table, column, definition } of ADDED_COLUMNS) {
    const existing = db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${table})`));
    if (existing.some((c) => c.name === column)) continue;
    db.run(sql.raw(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`));
  }
}

let cached: Db | null = null;

export function getDb(): Db {
  if (cached) return cached;
  const dataDir = process.env.DATA_DIR ?? "./data";
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(path.join(dataDir, "finmodel.db"));
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  migrate(db);
  cached = db;
  return db;
}
