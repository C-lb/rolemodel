"use client";

import { useState } from "react";
import { lineItem } from "@/model/taxonomy";
import { ratio as builtinRatio } from "@/model/ratios/library";
import type { RatioComponent, RatioPeriodResult, RatioResult } from "@/model/ratios/compute";
import { formatMoney, formatRatio } from "./format";
import { Sparkline } from "./Sparkline";
import { Tooltip } from "./Tooltip";
import { tooltip } from "./tooltips";

/** The state of the generated half, owned by the screen and passed down. */
export type ReadingState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; text: string }
  | { state: "declined"; reason: string | null }
  | { state: "failed"; message: string };

interface Props {
  result: RatioResult;
  onExplain: (key: string) => void;
  onShowProvenance: (canonicalKey: string, periodKey: string) => void;
  onDelete?: (key: string) => void;
  reading?: ReadingState;
}

const DIRECTION_COPY: Record<RatioResult["direction"], string> = {
  higher: "Higher is generally better",
  lower: "Lower is generally better",
  context: "Neither direction is better on its own",
};

/** A canonical key rendered the way it is labelled on the statements, never as a raw key. */
function labelFor(name: string): string {
  return lineItem(name)?.label ?? builtinRatio(name)?.label ?? name;
}

function listLabels(names: string[]): string {
  const labels = names.map(labelFor);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * Why a period has no number, in the terms of the business rather than of the code. A
 * negative-equity ROE and a zero-interest coverage are different facts, and a shared
 * "not available" would hide both.
 */
function explainAbsence(result: RatioResult, period: RatioPeriodResult): string {
  if (period.state === "unavailable") {
    if (period.notes.some((n) => n.code === "cycle")) {
      return "This ratio refers back to itself, so it has no value.";
    }
    if (period.missing.length === 0) return "The figures behind this ratio are not available.";
    return `Needs ${listLabels(period.missing)}, which the statements do not have for this period.`;
  }

  if (period.denominatorReason === "negative") {
    return result.key === "net_debt_to_ebitda"
      ? "EBITDA is negative for this period, so a leverage multiple would read as low risk when it means the opposite."
      : "Shareholders' equity is negative for this period, so a return on it cannot be read.";
  }

  return result.key === "interest_coverage" || result.key === "ebitda_interest_coverage"
    ? "There is no interest expense in this period, so there is nothing to cover."
    : "The denominator is zero for this period.";
}

function ComponentRow({
  component,
  onShowProvenance,
}: {
  component: RatioComponent;
  onShowProvenance: (canonicalKey: string, periodKey: string) => void;
}) {
  const stored = component.storedValue;
  const used = component.usedValue;
  const adjusted = used !== undefined && stored !== undefined && used !== stored;

  const body = (
    <span className="flex w-full min-w-0 items-baseline justify-between gap-4">
      <span className="min-w-0 truncate text-neutral-300">{labelFor(component.name)}</span>
      <span className="shrink-0 tabular-nums text-neutral-400">
        {adjusted ? (
          <>
            <span className="text-neutral-500">({formatMoney(stored)})</span>{" "}
            <span className="text-neutral-200">{formatMoney(used)}</span>
          </>
        ) : (
          <span className="text-neutral-200">{formatMoney(used)}</span>
        )}
      </span>
    </span>
  );

  if (!component.isLineItem) {
    return <li className="flex px-3 py-1.5 text-xs leading-relaxed">{body}</li>;
  }

  return (
    <li className="flex">
      <button
        type="button"
        onClick={() => onShowProvenance(component.name, component.periodKey)}
        aria-label={`${labelFor(component.name)}, ${component.periodKey}`}
        className="flex w-full min-w-0 rounded-[10px] px-3 py-1.5 text-left text-xs leading-relaxed transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
      >
        {body}
      </button>
    </li>
  );
}

export function RatioCard({ result, onExplain, onShowProvenance, onDelete, reading = { state: "idle" } }: Props) {
  const [showInputs, setShowInputs] = useState(false);

  // Results arrive most recent first, which is how the figures are read. The trend line
  // reads left to right in time, so it takes the reverse.
  const latest = result.periods[0];
  const chronological = [...result.periods].reverse();
  const trend = chronological.map((p) => (p.state === "ok" && p.value !== undefined ? p.value : null));

  // A card covers every period, so it carries every period's notes, deduplicated. Showing
  // only the latest period's would hide the averaging fallback, which by definition lands
  // on the earliest period.
  const notes = [
    ...new Map(
      result.periods
        .flatMap((period) => period.notes)
        .filter((note) => note.code !== "cycle")
        .map((note) => [note.code, note]),
    ).values(),
  ];
  const help = result.isCustom ? null : tooltip(`ratio.${result.key}`);

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-neutral-900/60 p-4">
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          {help ? (
            <Tooltip label={help}>
              <h3 className="truncate text-sm font-medium leading-snug text-neutral-200">{result.label}</h3>
            </Tooltip>
          ) : (
            <h3 className="truncate text-sm font-medium leading-snug text-neutral-200">{result.label}</h3>
          )}
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">{DIRECTION_COPY[result.direction]}</p>
        </div>
        {onDelete && result.isCustom && (
          <button
            type="button"
            onClick={() => onDelete(result.key)}
            className="shrink-0 whitespace-nowrap rounded-[10px] border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
          >
            Delete
          </button>
        )}
      </header>

      <div className="flex min-w-0 items-end justify-between gap-4">
        <p className="min-w-0 text-2xl leading-tight tracking-tight text-neutral-100 tabular-nums">
          {latest && latest.state === "ok" && latest.value !== undefined
            ? formatRatio(latest.value, result.unit)
            : "—"}
        </p>
        <Sparkline values={trend} label={`${result.label} trend`} />
      </div>

      {latest && latest.state !== "ok" && (
        <p className="text-xs leading-relaxed text-amber-200/80">{explainAbsence(result, latest)}</p>
      )}

      <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs leading-relaxed">
        {result.periods.map((period) => (
          <div key={period.periodKey} className="flex items-baseline gap-2">
            <dt className="text-neutral-500">{period.periodKey}</dt>
            <dd className="tabular-nums text-neutral-300">
              {period.state === "ok" && period.value !== undefined
                ? formatRatio(period.value, result.unit)
                : "—"}
            </dd>
          </div>
        ))}
      </dl>

      {result.isCustom && (
        <div className="flex flex-col gap-1.5">
          <code className="block break-words rounded-[10px] bg-white/[0.04] px-2.5 py-1.5 font-mono text-xs leading-relaxed text-neutral-300">
            {result.expression}
          </code>
          {result.note && <p className="text-xs leading-relaxed text-neutral-400">{result.note}</p>}
        </div>
      )}

      {notes.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {notes.map((note) => (
            <li key={note.code} className="text-xs leading-relaxed text-amber-200/70">
              {note.detail}
            </li>
          ))}
        </ul>
      )}

      {reading.state === "ready" && (
        <p className="text-xs leading-relaxed text-neutral-300">{reading.text}</p>
      )}
      {reading.state === "declined" && (
        <p className="text-xs leading-relaxed text-neutral-400">
          {reading.reason ?? "The numbers do not support a reading of this ratio."}
        </p>
      )}
      {reading.state === "failed" && (
        <p className="text-xs leading-relaxed text-amber-200/80">{reading.message}</p>
      )}
      {reading.state === "loading" && (
        <p className="text-xs leading-relaxed text-neutral-500">Reading the numbers</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tooltip label={tooltip("control.ratio_explain")}>
          <button
            type="button"
            onClick={() => onExplain(result.key)}
            disabled={reading.state === "loading"}
            className="whitespace-nowrap rounded-[10px] border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:text-neutral-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
          >
            Explain the trend
          </button>
        </Tooltip>
        <Tooltip label={tooltip("control.ratio_inputs")}>
          <button
            type="button"
            onClick={() => setShowInputs((open) => !open)}
            aria-expanded={showInputs}
            className="whitespace-nowrap rounded-[10px] border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
          >
            {showInputs ? "Hide inputs" : "Show inputs"}
          </button>
        </Tooltip>
      </div>

      {showInputs && (
        <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-3">
          {result.periods.map((period) => (
            <div key={period.periodKey} className="flex flex-col gap-1">
              <p className="px-3 text-xs leading-relaxed text-neutral-500">
                {period.periodKey}
                {period.dayMultiplier !== undefined && ` · multiplied by ${period.dayMultiplier} days`}
                {period.components.some((c) => c.averaged) && " · balances averaged"}
              </p>
              <ul className="flex flex-col">
                {period.components.map((component) => (
                  <ComponentRow
                    key={`${component.name}-${component.periodKey}`}
                    component={component}
                    onShowProvenance={onShowProvenance}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
