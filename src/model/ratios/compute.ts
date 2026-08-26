import { lineItem, type StatementKind } from "../taxonomy";
import { sortPeriodsMostRecentFirst, isImmediatePredecessor } from "../periods";
import type { Cell, WorkspaceView } from "../workspace";
import { MAGNITUDE_KEYS, RATIOS, ZERO_IF_ABSENT_KEYS } from "./library";
import { parseExpression, identifiers, evaluate, type Node } from "./expression";
import type { AveragingMode, RatioDef, RatioDirection, RatioFamily, RatioUnit } from "./types";

/**
 * `closeEnough` in `../tolerance` carries an absolute floor of one currency unit, which is
 * right for money and useless for ratios: it would call 0.14 and 0.30 the same number.
 * Ratios are compared relatively, with a floor only to absorb floating-point noise.
 */
function ratiosAgree(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(1e-9, scale * 0.005);
}

/** Below this, the extractor's own confidence is worth putting in front of the user. */
const LOW_CONFIDENCE = 0.6;

const DAYS_IN_YEAR = 365;
/** A quarter of a year. Annualising a quarter by four is the same arithmetic in a less visible form. */
const DAYS_IN_QUARTER = 91.25;

export interface RatioComponent {
  /** The canonical line-item key, or the key of a referenced ratio. */
  name: string;
  /** What the workspace holds for this period, before any normalisation. */
  storedValue: number | undefined;
  /** What the ratio actually used, after magnitude and averaging. */
  usedValue: number | undefined;
  averaged: boolean;
  magnitudeApplied: boolean;
  periodKey: string;
  /** False for a component that is another ratio rather than a cell with provenance. */
  isLineItem: boolean;
}

export type RatioNoteCode =
  | "averaging_fallback"
  | "quarterly_annualised"
  | "mixed_period_types"
  | "low_confidence"
  | "contains_override"
  | "cycle";

export interface RatioNote {
  code: RatioNoteCode;
  detail: string;
}

export type RatioState = "ok" | "unavailable" | "undefined_denominator";

export interface RatioPeriodResult {
  periodKey: string;
  state: RatioState;
  value: number | undefined;
  missing: string[];
  denominatorReason: "zero" | "negative" | undefined;
  components: RatioComponent[];
  dayMultiplier: number | undefined;
  confidence: number | undefined;
  notes: RatioNote[];
}

export interface RatioResult {
  key: string;
  label: string;
  family: RatioFamily | "custom";
  unit: RatioUnit;
  direction: RatioDirection;
  isCustom: boolean;
  /** The user's own note, for custom ratios. */
  note: string | null;
  expression: string;
  periods: RatioPeriodResult[];
}

export interface CustomRatioInput {
  key: string;
  label: string;
  expression: string;
  note: string | null;
}

export interface ComputeInput {
  workspace: WorkspaceView;
  mode: AveragingMode;
  custom: CustomRatioInput[];
}

type Entry = {
  key: string;
  label: string;
  family: RatioFamily | "custom";
  unit: RatioUnit;
  direction: RatioDirection;
  isCustom: boolean;
  note: string | null;
  expression: string;
  dayScaled: boolean;
  positiveDenominator: boolean;
};

function entryFromDef(def: RatioDef): Entry {
  return {
    key: def.key,
    label: def.label,
    family: def.family,
    unit: def.unit,
    direction: def.direction,
    isCustom: false,
    note: null,
    expression: def.expression,
    dayScaled: def.dayScaled,
    positiveDenominator: def.denominatorMustBePositive,
  };
}

function entryFromCustom(input: CustomRatioInput): Entry {
  return {
    key: input.key,
    label: input.label,
    family: "custom",
    unit: "x",
    direction: "context",
    isCustom: true,
    note: input.note,
    expression: input.expression,
    dayScaled: false,
    positiveDenominator: false,
  };
}

function periodType(key: string): "FY" | "Q" | "unknown" {
  if (key.startsWith("FY")) return "FY";
  if (/^Q[1-4]-/.test(key)) return "Q";
  return "unknown";
}

function daysFor(periodKey: string): number {
  return periodType(periodKey) === "Q" ? DAYS_IN_QUARTER : DAYS_IN_YEAR;
}

function statementOf(name: string): StatementKind | undefined {
  return lineItem(name)?.statement;
}

/**
 * True when the expression divides or otherwise combines a figure earned over a period
 * with one measured on a single date. Only then does averaging the balance mean anything:
 * a current ratio measures both sides on the same day, and averaging one of them would
 * invent a comparison the statement never made.
 */
function mixesFlowAndStock(names: string[]): boolean {
  let hasStock = false;
  let hasFlow = false;
  for (const name of names) {
    const statement = statementOf(name);
    if (statement === "balance") hasStock = true;
    if (statement === "income" || statement === "cashflow") hasFlow = true;
  }
  return hasStock && hasFlow;
}

/** The period immediately before `period` within the workspace, if the workspace holds it. */
function priorPeriod(periods: string[], period: string): string | undefined {
  return periods.find((candidate) => isImmediatePredecessor(period, candidate));
}

interface ResolutionContext {
  workspace: WorkspaceView;
  mode: AveragingMode;
  periods: string[];
  period: string;
  averageBalances: boolean;
  components: RatioComponent[];
  cells: Cell[];
  /** Set when averaging was wanted but the prior period was not available. */
  fallback: boolean;
  /** Values of other ratios in this period, already computed. */
  ratioValues: Map<string, number | undefined>;
}

function resolveLineItem(context: ResolutionContext, name: string): number | undefined {
  const cell = context.workspace.cell(name, context.period);
  const stored = cell.value;
  const magnitude = MAGNITUDE_KEYS.includes(name);
  const zeroIfAbsent = stored === undefined && ZERO_IF_ABSENT_KEYS.includes(name);

  let used = zeroIfAbsent ? 0 : stored === undefined ? undefined : magnitude ? Math.abs(stored) : stored;
  let averaged = false;

  const isBalance = statementOf(name) === "balance";
  // A zero-if-absent key that is genuinely absent has nothing to average: both ends of
  // the period are the same asserted zero, not an observed balance that moved, so
  // averaging it would only manufacture a spurious "no prior period" fallback note.
  if (!zeroIfAbsent && isBalance && context.averageBalances && used !== undefined) {
    const prior = priorPeriod(context.periods, context.period);
    if (prior === undefined) {
      context.fallback = true;
    } else {
      const priorCell = context.workspace.cell(name, prior);
      const priorValue = priorCell.value;
      if (priorValue === undefined) {
        context.fallback = true;
      } else {
        const priorUsed = magnitude ? Math.abs(priorValue) : priorValue;
        used = (used + priorUsed) / 2;
        averaged = true;
        context.cells.push(priorCell);
      }
    }
  }

  context.cells.push(cell);
  context.components.push({
    name,
    storedValue: stored,
    usedValue: used,
    averaged,
    magnitudeApplied: magnitude && stored !== undefined,
    periodKey: context.period,
    isLineItem: true,
  });

  return used;
}

/** Depth-first order over ratio-to-ratio references, with the cycles pulled out. */
function orderEntries(entries: Entry[]): { order: string[]; cycles: Set<string> } {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const dependencies = new Map<string, string[]>();

  for (const entry of entries) {
    const parsed = parseExpression(entry.expression);
    const names = parsed.ok ? identifiers(parsed.node) : [];
    dependencies.set(
      entry.key,
      names.filter((name) => byKey.has(name)),
    );
  }

  const order: string[] = [];
  const cycles = new Set<string>();
  const state = new Map<string, "visiting" | "done">();

  function visit(key: string, stack: string[]): void {
    const current = state.get(key);
    if (current === "done") return;
    if (current === "visiting") {
      // Everything still on the stack from the first sighting of `key` is in the loop.
      const start = stack.indexOf(key);
      for (const member of stack.slice(start)) cycles.add(member);
      return;
    }
    state.set(key, "visiting");
    for (const dependency of dependencies.get(key) ?? []) {
      visit(dependency, [...stack, key]);
    }
    state.set(key, "done");
    order.push(key);
  }

  for (const entry of entries) visit(entry.key, []);
  return { order, cycles };
}

export function computeRatios(input: ComputeInput): RatioResult[] {
  const entries: Entry[] = [
    ...RATIOS.map(entryFromDef),
    ...input.custom.map(entryFromCustom),
  ];
  const byKey = new Map(entries.map((e) => [e.key, e]));

  const periods = sortPeriodsMostRecentFirst(input.workspace.periods);
  const types = new Set(periods.map(periodType).filter((t) => t !== "unknown"));
  const mixedPeriods = types.size > 1;

  const { order, cycles } = orderEntries(entries);

  // Per period, keyed by ratio: the value another ratio can reference.
  const valuesByPeriod = new Map<string, Map<string, number | undefined>>(
    periods.map((p) => [p, new Map<string, number | undefined>()]),
  );

  const resultsByKey = new Map<string, RatioResult>();

  for (const key of order) {
    const entry = byKey.get(key);
    if (!entry) continue;

    const parsed = parseExpression(entry.expression);
    const node: Node | null = parsed.ok ? parsed.node : null;
    const names = node ? identifiers(node) : [];
    const lineItemNames = names.filter((name) => statementOf(name) !== undefined);
    const averageBalances = input.mode === "average" && mixesFlowAndStock(lineItemNames);
    const inCycle = cycles.has(key);

    const periodResults: RatioPeriodResult[] = periods.map((period) => {
      const notes: RatioNote[] = [];
      const components: RatioComponent[] = [];
      const cells: Cell[] = [];

      if (inCycle || node === null) {
        const detail = inCycle
          ? `"${entry.label}" refers back to itself through another ratio, so it has no value to compute.`
          : `"${entry.label}" has an expression that cannot be read.`;
        notes.push({ code: "cycle", detail });
        valuesByPeriod.get(period)?.set(key, undefined);
        return {
          periodKey: period,
          state: "unavailable",
          value: undefined,
          missing: [],
          denominatorReason: undefined,
          components,
          dayMultiplier: undefined,
          confidence: undefined,
          notes,
        };
      }

      const context: ResolutionContext = {
        workspace: input.workspace,
        mode: input.mode,
        periods,
        period,
        averageBalances,
        components,
        cells,
        fallback: false,
        ratioValues: valuesByPeriod.get(period) ?? new Map(),
      };

      const resolved = evaluate(
        node,
        (name) => {
          if (statementOf(name) !== undefined) return resolveLineItem(context, name);
          if (byKey.has(name)) {
            const value = context.ratioValues.get(name);
            components.push({
              name,
              storedValue: value,
              usedValue: value,
              averaged: false,
              magnitudeApplied: false,
              periodKey: period,
              isLineItem: false,
            });
            return value;
          }
          return undefined;
        },
        { positiveDenominator: entry.positiveDenominator },
      );

      const dayMultiplier = entry.dayScaled ? daysFor(period) : undefined;

      let state: RatioState;
      let value: number | undefined;
      let missing: string[] = [];
      let denominatorReason: "zero" | "negative" | undefined;

      switch (resolved.kind) {
        case "ok":
          state = "ok";
          value = dayMultiplier === undefined ? resolved.value : resolved.value * dayMultiplier;
          break;
        case "unavailable":
          state = "unavailable";
          missing = resolved.missing;
          break;
        case "undefined_denominator":
          state = "undefined_denominator";
          denominatorReason = resolved.reason;
          break;
        case "not_a_number":
          state = "unavailable";
          break;
      }

      if (value !== undefined && !Number.isFinite(value)) {
        state = "unavailable";
        value = undefined;
      }

      if (context.fallback) {
        notes.push({
          code: "averaging_fallback",
          detail:
            "No prior period is available, so this uses the closing balance rather than the average of opening and closing.",
        });
      }

      if (dayMultiplier === DAYS_IN_QUARTER) {
        notes.push({
          code: "quarterly_annualised",
          detail: "Computed from a single quarter at 91.25 days, not a trailing twelve months.",
        });
      }

      if (mixedPeriods && (entry.dayScaled || mixesFlowAndStock(lineItemNames))) {
        notes.push({
          code: "mixed_period_types",
          detail:
            "This workspace holds both annual and quarterly periods, so the trend compares figures earned over different lengths of time.",
        });
      }

      const confidences = cells
        .map((cell) => (cell.source === "override" ? undefined : cell.confidence))
        .filter((c): c is number => c !== undefined);
      const confidence = confidences.length > 0 ? Math.min(...confidences) : undefined;

      if (confidence !== undefined && confidence < LOW_CONFIDENCE) {
        notes.push({
          code: "low_confidence",
          detail: "One of the figures behind this ratio was extracted with low confidence.",
        });
      }

      if (cells.some((cell) => cell.source === "override")) {
        notes.push({
          code: "contains_override",
          detail: "One of the figures behind this ratio is your edit rather than the extracted value.",
        });
      }

      valuesByPeriod.get(period)?.set(key, value);

      return {
        periodKey: period,
        state,
        value,
        missing,
        denominatorReason,
        components,
        dayMultiplier,
        confidence,
        notes,
      };
    });

    resultsByKey.set(key, {
      key,
      label: entry.label,
      family: entry.family,
      unit: entry.unit,
      direction: entry.direction,
      isCustom: entry.isCustom,
      note: entry.note,
      expression: entry.expression,
      periods: periodResults,
    });
  }

  // Report in library order, then custom ratios in the order the user made them, rather
  // than in the dependency order the evaluation happened to need.
  return entries
    .map((entry) => resultsByKey.get(entry.key))
    .filter((result): result is RatioResult => result !== undefined);
}

export interface DupontResult {
  periodKey: string;
  netMargin: number | undefined;
  assetTurnover: number | undefined;
  equityMultiplier: number | undefined;
  product: number | undefined;
  roe: number | undefined;
  reconciles: boolean;
  /** Component keys that could not be computed, so the card can name them. */
  unavailable: string[];
}

const DUPONT_KEYS = ["net_margin", "asset_turnover", "equity_multiplier"] as const;

/**
 * The three-step decomposition, plus the check that it multiplies back to return on
 * equity. Reported rather than assumed: with averaged balances the identity holds only
 * approximately, and a card that hides the gap teaches the wrong thing.
 */
export function dupont(results: RatioResult[], periodKey: string): DupontResult {
  const valueOf = (key: string): number | undefined => {
    const period = results.find((r) => r.key === key)?.periods.find((p) => p.periodKey === periodKey);
    return period?.state === "ok" ? period.value : undefined;
  };

  const netMargin = valueOf("net_margin");
  const assetTurnover = valueOf("asset_turnover");
  const equityMultiplier = valueOf("equity_multiplier");
  const roe = valueOf("roe");

  const unavailable = DUPONT_KEYS.filter((key) => valueOf(key) === undefined) as string[];
  if (roe === undefined) unavailable.push("roe");

  const product =
    netMargin !== undefined && assetTurnover !== undefined && equityMultiplier !== undefined
      ? netMargin * assetTurnover * equityMultiplier
      : undefined;

  return {
    periodKey,
    netMargin,
    assetTurnover,
    equityMultiplier,
    product,
    roe,
    reconciles: product !== undefined && roe !== undefined && ratiosAgree(product, roe),
    unavailable,
  };
}
