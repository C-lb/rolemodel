/**
 * Period keys and their ordering.
 *
 * Three layers depend on "most recent first, so the prior period is the next entry":
 * `extract/merge` orders the set the extractor returned, `server/documents` re-derives
 * it from facts and overrides, and `model/validate` compares each period against the
 * next one. One shared definition, so those three cannot drift apart.
 *
 * Only two shapes can be ordered. Anything else is unrankable, and code that depends
 * on ordering must refuse to run rather than compare two unrelated periods.
 */

/** The only period-key shapes this model can order. Also enforced at the extraction boundary. */
export const PERIOD_KEY_PATTERN = /^(FY\d{4}|Q[1-4]-\d{4})$/;

/** The rank given to a key that cannot be ordered. Below every real rank. */
export const UNRANKED = -1;

export function isRankablePeriodKey(key: string): boolean {
  return PERIOD_KEY_PATTERN.test(key);
}

/** FY2024 sorts above FY2023; Q2-2025 above Q1-2025. Unrankable keys sort last, stably. */
export function periodRank(key: string): number {
  const fy = /^FY(\d{4})$/.exec(key);
  if (fy) return Number(fy[1]) * 10 + 9;
  const q = /^Q([1-4])-(\d{4})$/.exec(key);
  if (q) return Number(q[2]) * 10 + Number(q[1]);
  return UNRANKED;
}

/** Most recent first — the ordering every consumer of a period list assumes. */
export function sortPeriodsMostRecentFirst(keys: string[]): string[] {
  return [...keys].sort((a, b) => periodRank(b) - periodRank(a));
}

type Family = "annual" | "quarterly";

/** A rankable key as a family plus a position within that family's own regular sequence. */
function place(key: string): { family: Family; index: number } | undefined {
  const fy = /^FY(\d{4})$/.exec(key);
  if (fy) return { family: "annual", index: Number(fy[1]) };
  const q = /^Q([1-4])-(\d{4})$/.exec(key);
  if (q) return { family: "quarterly", index: Number(q[2]) * 4 + (Number(q[1]) - 1) };
  return undefined;
}

function keyAt(family: Family, index: number): string {
  if (family === "annual") return `FY${index}`;
  return `Q${(index % 4) + 1}-${Math.floor(index / 4)}`;
}

/**
 * True when `prior` is the period immediately before `period` in the same regular
 * sequence. A year-on-year comparison across a gap, or between a quarter and a full
 * year, is not a prior-period comparison at all.
 */
export function isImmediatePredecessor(period: string, prior: string): boolean {
  const a = place(period);
  const b = place(prior);
  if (!a || !b || a.family !== b.family) return false;
  return a.index - b.index === 1;
}

/**
 * Periods absent from an otherwise regular sequence, most recent first. Annual and
 * quarterly runs are considered separately: a filing that reports FY2024, FY2023 and
 * Q1-2025 has no gap. Unrankable keys are ignored here — they are reported on their own.
 */
export function missingPeriodsInSequence(keys: string[]): string[] {
  const byFamily = new Map<Family, number[]>();
  for (const key of keys) {
    const placed = place(key);
    if (!placed) continue;
    const list = byFamily.get(placed.family) ?? [];
    if (!list.includes(placed.index)) list.push(placed.index);
    byFamily.set(placed.family, list);
  }

  const missing: { family: Family; index: number }[] = [];
  for (const [family, indexes] of byFamily) {
    const present = new Set(indexes);
    const lo = Math.min(...indexes);
    const hi = Math.max(...indexes);
    for (let i = lo + 1; i < hi; i++) {
      if (!present.has(i)) missing.push({ family, index: i });
    }
  }

  return missing
    .map(({ family, index }) => keyAt(family, index))
    .sort((a, b) => periodRank(b) - periodRank(a));
}
