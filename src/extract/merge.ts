import { lineItem, UNMAPPED_KEY } from "@/model/taxonomy";
import { sortPeriodsMostRecentFirst } from "@/model/periods";
import { closeEnough } from "@/model/tolerance";
import type { Provenance } from "@/db/schema";
import type { ExtractedFigure } from "./schema";

export interface ExtractedFact {
  canonicalKey: string;
  periodKey: string;
  value: number;
  confidence: number;
  provenance: Provenance;
}

export interface MergeConflict {
  canonicalKey: string;
  periodKey: string;
  candidates: ExtractedFact[];
}

export interface MergeOutput {
  facts: ExtractedFact[];
  periods: string[];
  conflicts: MergeConflict[];
  unmappedLabels: string[];
}

function toFact(f: ExtractedFigure): ExtractedFact {
  return {
    canonicalKey: f.canonical_key,
    periodKey: f.period_key,
    value: f.value,
    confidence: f.confidence,
    provenance: {
      page: f.page,
      sheet: f.sheet,
      locator: f.locator,
      rawLabel: f.raw_label,
      rawValue: f.raw_value,
      scaleFactor: f.scale_factor,
      scaleEvidence: f.scale_evidence,
      signFlipped: f.sign_flipped,
    },
  };
}

interface Bucket {
  canonicalKey: string;
  periodKey: string;
  candidates: ExtractedFact[];
}

export function mergeFigures(figures: ExtractedFigure[]): MergeOutput {
  const buckets = new Map<string, Bucket>();
  const unmappedLabels: string[] = [];
  const periods = new Set<string>();

  for (const figure of figures) {
    periods.add(figure.period_key);
    const known = lineItem(figure.canonical_key);
    const unmapped = !known || figure.canonical_key === UNMAPPED_KEY;
    if (unmapped) unmappedLabels.push(figure.raw_label);

    // An unmapped figure is kept so the user can drag it to the right bucket, but
    // its raw label is what identifies it: the canonical key says nothing, so two
    // different stray labels in one period must not land on top of each other.
    const canonicalKey = unmapped ? UNMAPPED_KEY : figure.canonical_key;
    const id = unmapped
      ? `${UNMAPPED_KEY}::${figure.raw_label}::${figure.period_key}`
      : `${canonicalKey}::${figure.period_key}`;

    const bucket = buckets.get(id) ?? { canonicalKey, periodKey: figure.period_key, candidates: [] };
    bucket.candidates.push({ ...toFact(figure), canonicalKey });
    buckets.set(id, bucket);
  }

  const facts: ExtractedFact[] = [];
  const conflicts: MergeConflict[] = [];

  for (const { canonicalKey, periodKey, candidates } of buckets.values()) {
    const best = [...candidates].sort((a, b) => b.confidence - a.confidence)[0];
    facts.push(best);
    // Money is never compared with ===. Two chunks reading the same figure can
    // differ by rounding noise (a total taken from a footnote against the same
    // total on the face of the statement); that is one reading, not a conflict.
    const disagrees = candidates.some((c) => !closeEnough(c.value, best.value));
    // Nothing downstream reads an unmapped figure, so two readings of one cannot
    // disagree in a way that matters. Reconciling it starts with mapping it.
    if (disagrees && canonicalKey !== UNMAPPED_KEY) {
      conflicts.push({ canonicalKey, periodKey, candidates });
    }
  }

  return {
    facts,
    periods: sortPeriodsMostRecentFirst([...periods]),
    conflicts,
    unmappedLabels: [...new Set(unmappedLabels)],
  };
}
