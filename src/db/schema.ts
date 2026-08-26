import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export interface Provenance {
  page: number | null;
  sheet: string | null;
  locator: string;
  rawLabel: string;
  rawValue: string;
  scaleFactor: number;
  scaleEvidence: string;
  signFlipped: boolean;
}

export interface MergeConflictRecord {
  canonicalKey: string;
  periodKey: string;
  candidates: { value: number; confidence: number; provenance: Provenance }[];
}

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  kind: text("kind", { enum: ["pdf", "spreadsheet"] }).notNull(),
  hash: text("hash").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  ingestedAt: integer("ingested_at").notNull(),
});

export const extractionRuns = sqliteTable("extraction_runs", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  promptVersion: integer("prompt_version").notNull(),
  status: text("status", { enum: ["pending", "complete", "failed"] }).notNull(),
  error: text("error"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  createdAt: integer("created_at").notNull(),
  conflicts: text("conflicts", { mode: "json" }).$type<MergeConflictRecord[]>().notNull().default(sql`'[]'`),
});

export const facts = sqliteTable("facts", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => extractionRuns.id, { onDelete: "cascade" }),
  canonicalKey: text("canonical_key").notNull(),
  periodKey: text("period_key").notNull(),
  value: real("value").notNull(),
  confidence: real("confidence").notNull(),
  provenance: text("provenance", { mode: "json" }).$type<Provenance>().notNull(),
}, (t) => ({
  byRun: index("facts_by_run").on(t.runId),
  byKey: index("facts_by_key").on(t.canonicalKey, t.periodKey),
}));

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  activeRunId: text("active_run_id").references(() => extractionRuns.id, { onDelete: "set null" }),
  /** 'average' | 'ending'. Balance-sheet denominators in flow-over-stock ratios. */
  averagingMode: text("averaging_mode").notNull().default("average"),
  createdAt: integer("created_at").notNull(),
});

export const customRatios = sqliteTable("custom_ratios", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  /** Unique within a workspace, and never equal to a built-in ratio key. */
  key: text("key").notNull(),
  label: text("label").notNull(),
  expression: text("expression").notNull(),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => ({
  byWorkspace: index("custom_ratios_by_workspace").on(t.workspaceId),
}));

/**
 * One cached generated reading per ratio per set of numbers. `inputHash` covers the model,
 * the prompt version, the averaging mode and every value shown to the model, so an edited
 * figure regenerates the text and a reopened workspace does not.
 */
export const interpretations = sqliteTable("interpretations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ratioKey: text("ratio_key").notNull(),
  inputHash: text("input_hash").notNull(),
  text: text("text").notNull(),
  declined: integer("declined").notNull(),
  reason: text("reason"),
  modelId: text("model_id").notNull(),
  promptVersion: integer("prompt_version").notNull(),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  createdAt: integer("created_at").notNull(),
}, (t) => ({
  byWorkspace: index("interpretations_by_workspace").on(t.workspaceId),
}));

export const overrides = sqliteTable("overrides", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  canonicalKey: text("canonical_key").notNull(),
  periodKey: text("period_key").notNull(),
  value: real("value").notNull(),
  note: text("note"),
  updatedAt: integer("updated_at").notNull(),
}, (t) => ({
  byWorkspace: index("overrides_by_workspace").on(t.workspaceId),
}));
