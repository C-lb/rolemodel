import { and, eq, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import { lineItem, UNMAPPED_KEY } from "@/model/taxonomy";
import type { Deps } from "./documents";

/**
 * Move one extracted fact to a different canonical line item, keeping its
 * provenance intact: where a figure came from does not change just because the
 * extractor filed it in the wrong bucket.
 *
 * `unmapped` is a legal destination. It is how a remap is undone: the figure
 * goes back to the drawer rather than being stranded in the wrong line.
 */
export async function remapFact(
  deps: Deps,
  workspaceId: string,
  factId: string,
  toCanonicalKey: string,
): Promise<void> {
  const target = lineItem(toCanonicalKey);
  if (!target && toCanonicalKey !== UNMAPPED_KEY) {
    throw new Error(`"${toCanonicalKey}" is not a canonical line item.`);
  }

  const [workspace] = deps.db.select().from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId)).all();
  if (!workspace) throw new Error(`No workspace "${workspaceId}".`);

  const [fact] = deps.db.select().from(schema.facts).where(eq(schema.facts.id, factId)).all();
  if (!fact) throw new Error(`No fact "${factId}".`);

  // A server action is a public endpoint, so the fact id it is handed is not
  // trusted to belong to the workspace the caller named.
  if (fact.runId !== workspace.activeRunId) {
    throw new Error(`Fact "${factId}" does not belong to this workspace.`);
  }

  // Only a real line item can already be taken. Unmapped figures occupy no line,
  // so any number of them can share one period.
  if (target) {
    // Two places can hold the target cell, and the user sees whichever wins:
    // an extracted fact in this run, or a value they typed over the top of it.
    // Checking only the first would let a figure disappear behind an override.
    const clash = deps.db.select().from(schema.facts).where(and(
      // Scoped to the run: two documents may each report inventory for FY2024
      // without either being in the other's way.
      eq(schema.facts.runId, fact.runId),
      eq(schema.facts.canonicalKey, toCanonicalKey),
      eq(schema.facts.periodKey, fact.periodKey),
      ne(schema.facts.id, factId),
    )).all();

    const overridden = deps.db.select().from(schema.overrides).where(and(
      eq(schema.overrides.workspaceId, workspaceId),
      eq(schema.overrides.canonicalKey, toCanonicalKey),
      eq(schema.overrides.periodKey, fact.periodKey),
    )).all();

    if (overridden.length > 0) {
      throw new Error(
        `${target.label} already has a value you entered for ${fact.periodKey}. Clear it before moving this line there.`,
      );
    }
    if (clash.length > 0) {
      throw new Error(
        `${target.label} already has an extracted value for ${fact.periodKey}. Clear it before moving this line there.`,
      );
    }
  }

  // Read-then-write with no transaction is safe here: better-sqlite3 is
  // synchronous and there is no await between the checks above and this update,
  // so nothing else in this process can slip a write in between.
  deps.db.update(schema.facts)
    .set({ canonicalKey: toCanonicalKey })
    .where(eq(schema.facts.id, factId))
    .run();
}
