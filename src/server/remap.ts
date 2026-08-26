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
export async function remapFact(deps: Deps, factId: string, toCanonicalKey: string): Promise<void> {
  const target = lineItem(toCanonicalKey);
  if (!target && toCanonicalKey !== UNMAPPED_KEY) {
    throw new Error(`"${toCanonicalKey}" is not a canonical line item.`);
  }

  const [fact] = deps.db.select().from(schema.facts).where(eq(schema.facts.id, factId)).all();
  if (!fact) throw new Error(`No fact "${factId}".`);

  // Only a real line item can already be taken. Unmapped figures occupy no line,
  // so any number of them can share one period.
  if (target) {
    // Scoped to the run: two documents may each report inventory for FY2024
    // without either being in the other's way.
    const clash = deps.db.select().from(schema.facts).where(and(
      eq(schema.facts.runId, fact.runId),
      eq(schema.facts.canonicalKey, toCanonicalKey),
      eq(schema.facts.periodKey, fact.periodKey),
      ne(schema.facts.id, factId),
    )).all();

    if (clash.length > 0) {
      throw new Error(
        `${target.label} already has a value for ${fact.periodKey}. Clear it before moving this line there.`,
      );
    }
  }

  deps.db.update(schema.facts)
    .set({ canonicalKey: toCanonicalKey })
    .where(eq(schema.facts.id, factId))
    .run();
}
