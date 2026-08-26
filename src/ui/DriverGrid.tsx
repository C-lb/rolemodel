"use client";

import { Fragment } from "react";
import type { Cell } from "@/model/workspace";
import { driver } from "@/model/forecast/drivers";
import type { DriverBasis } from "@/model/forecast/seed";
import { formatDriverValue, parseDriverValue, driverEditValue } from "./format";
import { EditableCell } from "./EditableCell";
import { Tooltip } from "./Tooltip";
import { tooltip } from "./tooltips";

export interface DriverSeedInfo {
  basis: DriverBasis;
  note: string;
}

export interface DriverCellValue {
  periodKey: string;
  value: number;
  /**
   * Present only when this cell's value still equals what scenario creation seeded it
   * to (Task 8's comparison, not this component's — DriverGrid only renders what it is
   * told). Its absence is what turns the marker off once a user edits the cell.
   */
  seed?: DriverSeedInfo;
}

export interface DriverRowData {
  /** A key from `DRIVER_KEYS`. */
  key: string;
  cells: DriverCellValue[];
}

interface Props {
  rows: DriverRowData[];
  /** Forecast periods, in the order the columns should read left to right. */
  periods: string[];
  onCommit: (driverKey: string, periodKey: string, value: number) => void;
  onFillRight: (driverKey: string, sourcePeriodKey: string) => void;
}

function SeedMarker({ seed }: { seed: DriverSeedInfo }) {
  const prefix = seed.basis === "derived" ? "Derived from history: " : "Default value: ";
  return (
    <Tooltip label={`${tooltip("control.driver_seed_marker")} ${prefix}${seed.note}`}>
      <span
        tabIndex={0}
        aria-label="Seeded value"
        className="inline-flex size-[0.9em] shrink-0 items-center justify-center rounded-full border border-white/20 text-[0.65em] text-neutral-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="size-[0.7em]">
          <circle cx="12" cy="12" r="1" />
        </svg>
      </span>
    </Tooltip>
  );
}

function FillRightIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-[0.85em]">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}

/**
 * WORKAROUND: `EditableCell` only knows how to edit a workspace `Cell` — it has no
 * concept of a driver. This fabricates the minimum `Cell` shape it needs so a driver
 * value can flow through that one editing surface rather than a second one built for
 * drivers specifically (see the file header comment on `EditableCell.tsx`'s Task 7
 * extension). `source: "extracted"` is the only choice that keeps the cell editable:
 * `EditableCell` refuses `"forecast"`, and a driver is never that. `extractedValue`,
 * `confidence` and `provenance` are all genuinely absent for a driver — there is no
 * source document behind it — so `undefined` here isn't a stand-in, it's the truth.
 */
function driverAsCell(canonicalKey: string, periodKey: string, value: number): Cell {
  return {
    canonicalKey,
    periodKey,
    value,
    source: "extracted",
    extractedValue: undefined,
    confidence: undefined,
    provenance: undefined,
  };
}

export function DriverGrid({ rows, periods, onCommit, onFillRight }: Props) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-neutral-900/60">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <caption className="sr-only">Forecast drivers</caption>
        <thead>
          <tr className="border-b border-white/[0.06]">
            <th scope="col" className="px-3 py-2.5 text-left font-medium text-neutral-400">Driver</th>
            {periods.map((p) => (
              <th key={p} scope="col" className="px-3 py-2.5 text-right font-medium text-neutral-400">{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const def = driver(row.key);
            const unit = def?.unit ?? "currency";
            const label = def?.label ?? row.key;
            const cellByPeriod = new Map(row.cells.map((c) => [c.periodKey, c]));

            return (
              <Fragment key={row.key}>
                <tr>
                  <th scope="row" className="px-3 py-1.5 text-left align-middle font-normal">
                    {def ? (
                      <Tooltip label={def.tooltip}>
                        <span className="text-neutral-200">{label}</span>
                      </Tooltip>
                    ) : (
                      <span className="text-neutral-200">{label}</span>
                    )}
                  </th>
                  {periods.map((periodKey) => {
                    const data = cellByPeriod.get(periodKey);
                    if (!data) return <td key={periodKey} className="px-2 py-1.5" />;
                    return (
                      <EditableCell
                        key={periodKey}
                        cell={driverAsCell(row.key, periodKey, data.value)}
                        onCommit={(value) => onCommit(row.key, periodKey, value)}
                        onReset={() => {}}
                        onInspect={() => {}}
                        label={label}
                        format={(v) => formatDriverValue(v, unit)}
                        parse={(input) => parseDriverValue(input, unit)}
                        toEditable={(v) => driverEditValue(v, unit)}
                      />
                    );
                  })}
                </tr>
                {/*
                  WORKAROUND: `EditableCell` renders its own `<td>` (see EditableCell.tsx),
                  so there is nowhere inside the value cell above to also put a seed
                  marker or a fill-right button without editing that component's markup
                  again. Each driver is therefore two table rows: the editable value row
                  above, and this thin controls row beneath it, column-aligned with it.
                */}
                <tr className="border-b border-white/[0.04]">
                  <th scope="row" className="px-3 py-0.5 text-left align-middle">
                    <span className="sr-only">Seed and fill controls for {label}</span>
                  </th>
                  {periods.map((periodKey, index) => {
                    const data = cellByPeriod.get(periodKey);
                    const isLast = index === periods.length - 1;
                    return (
                      <td key={periodKey} className="px-2 pb-1 text-right align-middle">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {data?.seed && <SeedMarker seed={data.seed} />}
                          {!isLast && (
                            <Tooltip label={tooltip("control.driver_fill_right")} align="end">
                              <button
                                type="button"
                                aria-label={`Fill ${label.toLowerCase()} right from ${periodKey}`}
                                onClick={() => onFillRight(row.key, periodKey)}
                                className="rounded-[10px] p-0.5 text-neutral-500 transition-colors hover:bg-white/10 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                              >
                                <FillRightIcon />
                              </button>
                            </Tooltip>
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
