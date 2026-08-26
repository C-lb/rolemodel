"use client";

import type { SensitivityResult, SensitivityCell } from "@/model/forecast/sensitivity";
import type { DriverUnit } from "@/model/forecast/drivers";
import { formatDriverValue } from "./format";
import { Tooltip } from "./Tooltip";
import { tooltip } from "./tooltips";

interface Props {
  result: SensitivityResult;
  rowLabel: string;
  columnLabel: string;
  rowUnit: DriverUnit;
  columnUnit: DriverUnit;
  /** The output metric's own formatting, decided by the caller (a taxonomy unit or a ratio unit). */
  formatValue: (value: number) => string;
}

type Direction = "above" | "below" | "base";

function DirectionIcon({ direction }: { direction: Direction }) {
  if (direction === "base") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="size-[0.7em]">
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  const points = direction === "above" ? "12 6 18 16 6 16" : "12 18 6 8 18 8";
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="size-[0.6em]">
      <polygon points={points} />
    </svg>
  );
}

/** Distance from the base value, bucketed 1..4, independent of direction. Drives shading intensity. */
function magnitudeBucket(value: number, base: number, spread: number): number {
  if (spread === 0) return 0;
  const ratio = Math.min(1, Math.abs(value - base) / spread);
  return Math.max(1, Math.round(ratio * 4));
}

function readableReason(reason: string): string {
  return reason.replaceAll("_", " ");
}

export function SensitivityGrid({ result, rowLabel, columnLabel, rowUnit, columnUnit, formatValue }: Props) {
  const okCells = result.cells.flat().filter((c): c is Extract<SensitivityCell, { state: "ok" }> => c.state === "ok");
  const baseCell = okCells.find((c) => c.isBase);
  const baseValue = baseCell?.value;
  const values = okCells.map((c) => c.value);
  const spread = values.length > 0 ? Math.max(...values) - Math.min(...values) : 0;

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-neutral-900/60 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-neutral-500">
        <span>Rows: <span className="text-neutral-300">{rowLabel}</span></span>
        <span>Columns: <span className="text-neutral-300">{columnLabel}</span></span>
        <Tooltip label={tooltip("control.sensitivity_shading")}>
          <span className="cursor-default underline decoration-dotted underline-offset-4">How shading works</span>
        </Tooltip>
      </div>
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <caption className="sr-only">Sensitivity grid: {rowLabel} against {columnLabel}</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1.5" />
            {result.columns.map((c) => (
              <th key={c} scope="col" className="px-2 py-1.5 text-right text-xs font-medium tabular-nums text-neutral-400">
                {formatDriverValue(c, columnUnit)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, rowIndex) => (
            <tr key={r}>
              <th scope="row" className="px-2 py-1.5 text-right text-xs font-medium tabular-nums text-neutral-400">
                {formatDriverValue(r, rowUnit)}
              </th>
              {result.columns.map((_, colIndex) => {
                const cell = result.cells[rowIndex][colIndex];
                const testId = `sensitivity-cell-${rowIndex}-${colIndex}`;

                if (cell.state === "failed") {
                  return (
                    <td
                      key={colIndex}
                      data-testid={testId}
                      className="border border-white/[0.06] px-2 py-1.5 text-center align-middle text-[0.7rem] leading-snug text-neutral-500"
                    >
                      {readableReason(cell.reason)}
                    </td>
                  );
                }

                const direction: Direction = cell.isBase
                  ? "base"
                  : baseValue === undefined || cell.value === baseValue
                    ? "base"
                    : cell.value > baseValue
                      ? "above"
                      : "below";
                const magnitude = baseValue === undefined ? 0 : magnitudeBucket(cell.value, baseValue, spread);
                const shadeOpacity = magnitude === 0 ? 0 : magnitude * 0.12;

                return (
                  <td
                    key={colIndex}
                    data-testid={testId}
                    data-direction={direction}
                    data-magnitude={magnitude}
                    style={
                      direction !== "base"
                        ? { backgroundColor: `rgba(56, 189, 248, ${shadeOpacity})` }
                        : undefined
                    }
                    className={[
                      "px-2 py-1.5 text-right align-middle tabular-nums text-neutral-100",
                      cell.isBase
                        ? "ring-2 ring-inset ring-sky-400"
                        : "border border-white/[0.04]",
                    ].join(" ")}
                  >
                    <Tooltip label={cell.isBase ? tooltip("control.sensitivity_base_cell") : `${rowLabel} ${formatDriverValue(r, rowUnit)}, ${columnLabel} ${formatDriverValue(result.columns[colIndex], columnUnit)}`}>
                      <span className="inline-flex items-center justify-end gap-1">
                        {direction !== "base" && (
                          <span className={direction === "above" ? "text-sky-300" : "text-neutral-500"}>
                            <DirectionIcon direction={direction} />
                          </span>
                        )}
                        {formatValue(cell.value)}
                      </span>
                    </Tooltip>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
