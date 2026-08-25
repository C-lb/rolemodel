import { itemsFor, type LineItemDef, type StatementKind } from "./taxonomy";
import { validate, type Finding } from "./validate";
import type { Provenance } from "@/db/schema";

export interface ExtractedFactLike {
  canonicalKey: string;
  periodKey: string;
  value: number;
  confidence: number;
  provenance: Provenance;
}

export interface OverrideLike {
  canonicalKey: string;
  periodKey: string;
  value: number;
}

export interface Cell {
  canonicalKey: string;
  periodKey: string;
  value: number | undefined;
  source: "extracted" | "override" | "absent";
  extractedValue: number | undefined;
  confidence: number | undefined;
  provenance: Provenance | undefined;
}

export interface StatementRow {
  def: LineItemDef;
  cells: Cell[];
}

export interface WorkspaceInput {
  periods: string[];
  facts: ExtractedFactLike[];
  overrides: OverrideLike[];
  scaleFactors?: number[];
  conflicts?: { canonicalKey: string; periodKey: string }[];
}

export interface WorkspaceView {
  periods: string[];
  cell(canonicalKey: string, periodKey: string): Cell;
  statement(kind: StatementKind): StatementRow[];
  findings: Finding[];
}

const id = (key: string, period: string) => `${key}::${period}`;

export function buildWorkspace(input: WorkspaceInput): WorkspaceView {
  const factIndex = new Map(input.facts.map((f) => [id(f.canonicalKey, f.periodKey), f]));
  const overrideIndex = new Map(input.overrides.map((o) => [id(o.canonicalKey, o.periodKey), o]));

  function cell(canonicalKey: string, periodKey: string): Cell {
    const fact = factIndex.get(id(canonicalKey, periodKey));
    const override = overrideIndex.get(id(canonicalKey, periodKey));
    const base: Omit<Cell, "value" | "source"> = {
      canonicalKey,
      periodKey,
      extractedValue: fact?.value,
      confidence: fact?.confidence,
      provenance: fact?.provenance,
    };
    if (override) return { ...base, value: override.value, source: "override" };
    if (fact) return { ...base, value: fact.value, source: "extracted" };
    return { ...base, value: undefined, source: "absent" };
  }

  const valueAt = (key: string, period: string) => cell(key, period).value;
  const confidenceAt = (key: string, period: string) => {
    const c = cell(key, period);
    // A figure the user has typed themselves is not low-confidence.
    return c.source === "override" ? undefined : c.confidence;
  };

  return {
    periods: input.periods,
    cell,
    statement(kind) {
      return itemsFor(kind).map((def) => ({
        def,
        cells: input.periods.map((p) => cell(def.key, p)),
      }));
    },
    findings: validate({
      periods: input.periods,
      valueAt,
      confidenceAt,
      scaleFactors: input.scaleFactors,
      conflicts: input.conflicts,
    }),
  };
}
