"use client";

import { lineItem } from "@/model/taxonomy";
import { ratio as builtinRatio } from "@/model/ratios/library";
import type { DupontResult } from "@/model/ratios/compute";
import { formatRatio } from "./format";

interface Props {
  result: DupontResult;
}

const STEPS: { key: string; label: string; unit: "x" | "percent"; read: (r: DupontResult) => number | undefined }[] = [
  { key: "net_margin", label: "Net margin", unit: "percent", read: (r) => r.netMargin },
  { key: "asset_turnover", label: "Asset turnover", unit: "x", read: (r) => r.assetTurnover },
  { key: "equity_multiplier", label: "Equity multiplier", unit: "x", read: (r) => r.equityMultiplier },
];

function labelFor(key: string): string {
  return builtinRatio(key)?.label ?? lineItem(key)?.label ?? key;
}

/**
 * Return on equity split into the three things that produce it: what the company keeps
 * per unit of sales, how much sales the assets generate, and how much of those assets is
 * funded by other people's money.
 *
 * The reconciliation is shown rather than assumed. With averaged balances the identity
 * holds only approximately, and a card that hid the gap would teach the wrong lesson.
 */
export function DupontCard({ result }: Props) {
  const complete = STEPS.every((step) => step.read(result) !== undefined);

  // A labelled region rather than an article: `article` is reserved for a ratio card,
  // which is what the family grids count.
  return (
    <section aria-label="DuPont decomposition" className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-neutral-900/60 p-4">
      <div className="min-w-0">
        <h3 className="text-sm font-medium leading-snug text-neutral-200">DuPont decomposition</h3>
        <p className="mt-1 max-w-[68ch] text-xs leading-relaxed text-neutral-500">
          {result.periodKey}. Return on equity is margin times turnover times leverage, so a rising
          return can come from the business improving or from more borrowing.
        </p>
      </div>

      {complete ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 text-sm leading-relaxed">
          {STEPS.map((step, index) => (
            <span key={step.key} className="flex items-baseline gap-2">
              {index > 0 && <span className="text-neutral-600">×</span>}
              <span className="text-neutral-500">{step.label}</span>
              <span className="tabular-nums text-neutral-200">
                {formatRatio(step.read(result) ?? 0, step.unit)}
              </span>
            </span>
          ))}
          <span className="flex items-baseline gap-2">
            <span className="text-neutral-600">=</span>
            <span className="text-neutral-500">Return on equity</span>
            <span className="tabular-nums text-neutral-100">
              {result.roe === undefined ? "—" : formatRatio(result.roe, "percent")}
            </span>
          </span>
        </div>
      ) : (
        <p className="max-w-[68ch] text-xs leading-relaxed text-amber-200/80">
          Needs {result.unavailable.map(labelFor).join(", ")}, which could not be computed for this
          period.
        </p>
      )}

      {complete && !result.reconciles && (
        <p className="max-w-[68ch] text-xs leading-relaxed text-amber-200/80">
          The three components multiply to{" "}
          {result.product === undefined ? "—" : formatRatio(result.product, "percent")}, which does not
          match the return on equity above. With averaged balances the identity is approximate, so a
          small gap is expected and a large one points at a figure worth checking.
        </p>
      )}
    </section>
  );
}
