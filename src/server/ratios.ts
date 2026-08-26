import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { lineItem } from "@/model/taxonomy";
import { RATIOS, ratio as builtinRatio } from "@/model/ratios/library";
import { parseExpression, identifiers } from "@/model/ratios/expression";
import type { AveragingMode } from "@/model/ratios/types";
import type { CustomRatioInput } from "@/model/ratios/compute";
import type { ActionResult, Deps } from "./documents";

export interface StoredCustomRatio extends CustomRatioInput {
  id: string;
  updatedAt: number;
}

const AVERAGING_MODES: readonly AveragingMode[] = ["average", "ending"];

function failure(code: string, message: string, remediation: string): ActionResult<never> {
  return { ok: false, code, message, remediation };
}

export async function listCustomRatios(deps: Deps, workspaceId: string): Promise<StoredCustomRatio[]> {
  const rows = deps.db
    .select()
    .from(schema.customRatios)
    .where(eq(schema.customRatios.workspaceId, workspaceId))
    .all();

  return rows
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
      expression: row.expression,
      note: row.note,
      updatedAt: row.updatedAt,
    }));
}

/**
 * A readable key derived from the label, because the key is what the user types into
 * another expression. `R&D intensity` becomes `rd_intensity`, not a UUID nobody can refer to.
 */
function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "r$1");
  return slug === "" ? "ratio" : slug;
}

function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface SaveCustomRatioInput {
  workspaceId: string;
  /** Present when editing an existing ratio. Absent when creating one. */
  key?: string;
  label: string;
  expression: string;
  note: string | null;
}

/**
 * Walks the reference graph from `key`, over the expressions that would exist after this
 * save, and returns the loop it finds. Checked here rather than only at evaluation time so
 * a cycle is never stored: a stored cycle is a workspace that greets the user with an error.
 */
function findCycle(start: string, expressions: Map<string, string>): string[] | null {
  const stack: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();

  function visit(key: string): string[] | null {
    if (done.has(key)) return null;
    if (visiting.has(key)) return [...stack.slice(stack.indexOf(key)), key];

    visiting.add(key);
    stack.push(key);

    const expression = expressions.get(key);
    if (expression !== undefined) {
      const parsed = parseExpression(expression);
      if (parsed.ok) {
        for (const name of identifiers(parsed.node)) {
          if (!expressions.has(name)) continue;
          const cycle = visit(name);
          if (cycle) return cycle;
        }
      }
    }

    stack.pop();
    visiting.delete(key);
    done.add(key);
    return null;
  }

  return visit(start);
}

export async function saveCustomRatio(
  deps: Deps,
  input: SaveCustomRatioInput,
): Promise<ActionResult<{ key: string }>> {
  const label = input.label.trim();
  if (label === "") {
    return failure("invalid_label", "A ratio needs a name.", "Give the ratio a short name, such as \"R&D intensity\".");
  }

  const parsed = parseExpression(input.expression);
  if (!parsed.ok) {
    return failure(
      "invalid_expression",
      parsed.error.message,
      `Fix the expression at character ${parsed.error.offset + 1}.`,
    );
  }

  const existing = await listCustomRatios(deps, input.workspaceId);
  const names = identifiers(parsed.node);
  const knownRatioKeys = new Set([...RATIOS.map((r) => r.key), ...existing.map((r) => r.key)]);

  for (const name of names) {
    if (lineItem(name) !== undefined) continue;
    if (knownRatioKeys.has(name)) continue;
    return failure(
      "unknown_identifier",
      `"${name}" is not a line item or a ratio in this workspace.`,
      "Use a line item from the statements, or a ratio you have already saved.",
    );
  }

  const editing = input.key !== undefined ? existing.find((r) => r.key === input.key) : undefined;
  if (input.key !== undefined && editing === undefined) {
    return failure("not_found", `No custom ratio "${input.key}" in this workspace.`, "Reload the page and try again.");
  }

  const taken = new Set([...RATIOS.map((r) => r.key), ...existing.map((r) => r.key)]);
  if (editing) taken.delete(editing.key);
  const key = editing ? editing.key : uniqueKey(slugify(label), taken);

  // Every expression as it would stand after this save, so the check sees the new shape.
  const expressions = new Map<string, string>([
    ...RATIOS.map((r) => [r.key, r.expression] as const),
    ...existing.filter((r) => r.key !== key).map((r) => [r.key, r.expression] as const),
    [key, input.expression],
  ]);

  const cycle = findCycle(key, expressions);
  if (cycle) {
    const labelFor = (k: string) => builtinRatio(k)?.label ?? existing.find((r) => r.key === k)?.label ?? k;
    return failure(
      "cycle",
      `This makes ${cycle.map(labelFor).join(" depend on ")}, which refers back to itself.`,
      "Point the expression at line items, or at a ratio that does not depend on this one.",
    );
  }

  try {
    if (editing) {
      deps.db
        .update(schema.customRatios)
        .set({ label, expression: input.expression, note: input.note, updatedAt: deps.now() })
        .where(and(eq(schema.customRatios.workspaceId, input.workspaceId), eq(schema.customRatios.key, key)))
        .run();
      // The numbers behind the cached readings have changed shape, so the readings go.
      deps.db
        .delete(schema.interpretations)
        .where(
          and(
            eq(schema.interpretations.workspaceId, input.workspaceId),
            eq(schema.interpretations.ratioKey, key),
          ),
        )
        .run();
    } else {
      deps.db
        .insert(schema.customRatios)
        .values({
          id: deps.newId(),
          workspaceId: input.workspaceId,
          key,
          label,
          expression: input.expression,
          note: input.note,
          createdAt: deps.now(),
          updatedAt: deps.now(),
        })
        .run();
    }
  } catch (error) {
    return failure(
      "db_error",
      error instanceof Error ? error.message : "The ratio could not be saved.",
      "Try again. If it keeps happening, check the terminal running the app for the full database error.",
    );
  }

  return { ok: true, data: { key } };
}

export async function deleteCustomRatio(
  deps: Deps,
  workspaceId: string,
  key: string,
): Promise<ActionResult<null>> {
  const existing = await listCustomRatios(deps, workspaceId);
  if (!existing.some((r) => r.key === key)) {
    return failure("not_found", `No custom ratio "${key}" in this workspace.`, "Reload the page and try again.");
  }

  deps.db
    .delete(schema.interpretations)
    .where(and(eq(schema.interpretations.workspaceId, workspaceId), eq(schema.interpretations.ratioKey, key)))
    .run();
  deps.db
    .delete(schema.customRatios)
    .where(and(eq(schema.customRatios.workspaceId, workspaceId), eq(schema.customRatios.key, key)))
    .run();

  return { ok: true, data: null };
}

export async function readAveragingMode(deps: Deps, workspaceId: string): Promise<AveragingMode> {
  const row = deps.db
    .select({ mode: schema.workspaces.averagingMode })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .get();

  const stored = row?.mode;
  return stored === "ending" ? "ending" : "average";
}

export async function setAveragingMode(
  deps: Deps,
  workspaceId: string,
  mode: AveragingMode,
): Promise<ActionResult<null>> {
  if (!AVERAGING_MODES.includes(mode)) {
    return failure(
      "invalid_mode",
      `"${mode}" is not a way of reading balance-sheet denominators.`,
      "Choose either average balances or ending balances.",
    );
  }

  deps.db
    .update(schema.workspaces)
    .set({ averagingMode: mode })
    .where(eq(schema.workspaces.id, workspaceId))
    .run();

  return { ok: true, data: null };
}
