import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

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
  /** Number of annual forecast periods, 1-5. */
  forecastHorizon: integer("forecast_horizon").notNull().default(5),
  /** The scenario whose drivers currently drive the forecast statements. Cleared, never
   *  left dangling, when that scenario is deleted — see `scenarios.deleteScenario`. */
  activeScenarioId: text("active_scenario_id").references((): AnySQLiteColumn => scenarios.id, { onDelete: "set null" }),
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

/**
 * One scenario is `isBase`. Base, Bull and Bear are seeded together the moment the
 * first scenario for a workspace is created (spec §4.2, §9) — there is no workspace
 * with only some of the trio, and no scenario after that first batch is forced to be
 * one of those three names.
 */
export const scenarios = sqliteTable("scenarios", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isBase: integer("is_base").notNull().default(0),
  ordinal: integer("ordinal").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => ({
  byWorkspace: index("scenarios_by_workspace").on(t.workspaceId),
  uniqueName: uniqueIndex("scenarios_unique_name").on(t.workspaceId, t.name),
}));

/** Every value `drivers.basis` may hold. See the field comment below for what each means. */
export const DRIVER_BASIS_VALUES = ["derived", "default", "user"] as const;
export type StoredDriverBasis = (typeof DRIVER_BASIS_VALUES)[number];

/**
 * One row per (scenario, driver, forecast period). Every driver exists for every
 * forecast period from the moment a scenario is created (drivers.ts) — there is no
 * "unset means inherit" rule, so a missing row here is a bug, not a state to handle.
 *
 * `basis` is `"derived" | "default"` when seeded (see `DriverBasis` in
 * `model/forecast/seed.ts`), and `"user"` once `saveDriver` or `fillRight` has touched
 * the cell — a provenance the seeding layer has no reason to know about, so it is not
 * added to that narrower type. Enforced both here (drizzle's TS enum) and in the DDL's
 * `CHECK` constraint, so a bad value can reach neither the type nor the column.
 */
export const drivers = sqliteTable("drivers", {
  id: text("id").primaryKey(),
  scenarioId: text("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  periodKey: text("period_key").notNull(),
  value: real("value").notNull(),
  basis: text("basis", { enum: DRIVER_BASIS_VALUES }).notNull(),
  note: text("note").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => ({
  byScenario: index("drivers_by_scenario").on(t.scenarioId),
  uniqueCell: uniqueIndex("drivers_unique_cell").on(t.scenarioId, t.key, t.periodKey),
}));
