import { lineItem, UNMAPPED_KEY } from "@/model/taxonomy";
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

/** FY2024 sorts above FY2023; Q2-2025 above Q1-2025. Unrecognised keys sort last, stably. */
function periodRank(key: string): number {
  const fy = /^FY(\d{4})$/.exec(key);
  if (fy) return Number(fy[1]) * 10 + 9;
  const q = /^Q([1-4])-(\d{4})$/.exec(key);
  if (q) return Number(q[2]) * 10 + Number(q[1]);
  return -1;
}

export function mergeFigures(figures: ExtractedFigure[]): MergeOutput {
  const buckets = new Map<string, ExtractedFact[]>();
  const unmappedLabels: string[] = [];
  const periods = new Set<string>();

  for (const figure of figures) {
    periods.add(figure.period_key);
    const known = lineItem(figure.canonical_key);
    if (!known || figure.canonical_key === UNMAPPED_KEY) {
      unmappedLabels.push(figure.raw_label);
      continue;
    }
    const id = `${figure.canonical_key}::${figure.period_key}`;
    const list = buckets.get(id) ?? [];
    list.push(toFact(figure));
    buckets.set(id, list);
  }

  const facts: ExtractedFact[] = [];
  const conflicts: MergeConflict[] = [];

  for (const [id, candidates] of buckets) {
    const distinct = new Set(candidates.map((c) => c.value));
    const best = [...candidates].sort((a, b) => b.confidence - a.confidence)[0];
    facts.push(best);
    if (distinct.size > 1) {
      const [canonicalKey, periodKey] = id.split("::");
      conflicts.push({ canonicalKey, periodKey, candidates });
    }
  }

  return {
    facts,
    periods: [...periods].sort((a, b) => periodRank(b) - periodRank(a)),
    conflicts,
    unmappedLabels: [...new Set(unmappedLabels)],
  };
}
