"use client";

import { formatMoney } from "./format";
import { Tooltip } from "./Tooltip";
import { tooltip } from "./tooltips";

export interface ForecastCellData {
  kind: "historical" | "forecast";
  periodKey: string;
  value: number | undefined;
  /** Present on a forecast cell only: what `onExplain` is called with. */
  formula?: string;
  inputs?: { label: string; value: number }[];
}

export interface ForecastStatementRow {
  key: string;
  label: string;
  isSubtotal?: boolean;
  indent?: boolean;
  /** Rows the engine holds at their opening balance rather than moving with a driver (spec §5.4). */
  heldFlat?: boolean;
  /** Rows the engine holds at zero rather than at their last actual (spec §5.2). */
  heldAtZero?: boolean;
  cells: ForecastCellData[];
}

interface Props {
  title: string;
  rows: ForecastStatementRow[];
  onExplain: (
    row: { key: string; label: string },
    cell: { periodKey: string; formula: string; inputs: { label: string; value: number }[] },
  ) => void;
}

/**
 * A forecast cell: not editable, no edit affordance at all. Clicking or activating it
 * opens the explanation panel instead — the forecast's answer to M1's provenance panel
 * (`ProvenancePanel.tsx`). There is no double-click path here because there is nothing
 * to edit: a single interaction is unambiguous.
 */
function ForecastCell({
  row,
  cell,
  onExplain,
}: {
  row: { key: string; label: string };
  cell: ForecastCellData;
  onExplain: Props["onExplain"];
}) {
  function explain() {
    onExplain(row, {
      periodKey: cell.periodKey,
      formula: cell.formula ?? "",
      inputs: cell.inputs ?? [],
    });
  }

  return (
    <Tooltip label={tooltip("control.forecast_cell")} align="end">
      <button
        type="button"
        onClick={explain}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          explain();
        }}
        aria-label={`${row.label}, ${cell.periodKey}: ${formatMoney(cell.value)}. Show the forecast formula.`}
        className="rounded-[10px] px-1.5 py-0.5 tabular-nums text-neutral-200 transition-colors hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
      >
        {formatMoney(cell.value)}
      </button>
    </Tooltip>
  );
}

function Badge({ label, children }: { label: string; children: string }) {
  return (
    <Tooltip label={label}>
      <span className="ml-2 whitespace-nowrap rounded-[10px] border border-white/10 px-1.5 py-0.5 text-[0.7rem] font-normal text-neutral-500">
        {children}
      </span>
    </Tooltip>
  );
}

const HELD_FLAT_TOOLTIP = tooltip("control.held_flat_row");
const HELD_AT_ZERO_TOOLTIP = tooltip("control.held_at_zero_row");

export function ForecastStatement({ title, rows, onExplain }: Props) {
  const periods = rows[0]?.cells.map((c) => c.periodKey) ?? [];
  const firstForecastIndex = rows[0]?.cells.findIndex((c) => c.kind === "forecast") ?? -1;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium leading-snug text-neutral-300">{title}</h2>
      <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-neutral-900/60">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th scope="col" className="px-3 py-2.5 text-left font-medium text-neutral-400">Line item</th>
              {periods.map((p, index) => (
                <th
                  key={p}
                  scope="col"
                  data-testid={index === firstForecastIndex ? `forecast-seam-${p}` : undefined}
                  className={[
                    "px-3 py-2.5 text-right font-medium text-neutral-400",
                    index === firstForecastIndex ? "border-l border-white/10" : "",
                  ].join(" ")}
                >
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.isSubtotal ? "border-t border-white/[0.06] font-medium" : ""}>
                <th scope="row" className="px-3 py-1.5 text-left align-middle font-normal">
                  <span className={row.indent ? "pl-4 text-neutral-400" : "text-neutral-200"}>{row.label}</span>
                  {row.heldFlat && <Badge label={HELD_FLAT_TOOLTIP}>held flat</Badge>}
                  {row.heldAtZero && <Badge label={HELD_AT_ZERO_TOOLTIP}>held at zero</Badge>}
                </th>
                {row.cells.map((cell, index) => (
                  <td
                    key={cell.periodKey}
                    className={[
                      "px-2 py-1.5 text-right align-middle",
                      index === firstForecastIndex ? "border-l border-white/10" : "",
                    ].join(" ")}
                  >
                    {cell.kind === "forecast" ? (
                      <ForecastCell row={{ key: row.key, label: row.label }} cell={cell} onExplain={onExplain} />
                    ) : (
                      <span className="tabular-nums text-neutral-200">{formatMoney(cell.value)}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
