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
     created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS overrides (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     canonical_key TEXT NOT NULL, period_key TEXT NOT NULL, value REAL NOT NULL,
     note TEXT, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS overrides_by_workspace ON overrides(workspace_id)`,
];

export function migrate(db: Db): void {
  db.run(sql`PRAGMA foreign_keys = ON`);
  for (const statement of DDL) db.run(sql.raw(statement));
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
