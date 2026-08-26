"use client";

import type { StatementRow, Cell } from "@/model/workspace";
import { EditableCell } from "./EditableCell";
import { Tooltip } from "./Tooltip";
import { tooltip } from "./tooltips";

interface Props {
  title: string;
  rows: StatementRow[];
  periods: string[];
  onEdit: (key: string, period: string, value: number) => void;
  onReset: (key: string, period: string) => void;
  onInspect: (cell: Cell) => void;
}

export function StatementTable({ title, rows, periods, onEdit, onReset, onInspect }: Props) {
  const populated = rows.filter((r) => r.cells.some((c) => c.value !== undefined));
  if (populated.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium leading-snug text-neutral-300">{title}</h2>
      <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-neutral-900/60">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th scope="col" className="px-3 py-2.5 text-left font-medium text-neutral-400">Line item</th>
              {periods.map((p) => (
                <th key={p} scope="col" className="px-3 py-2.5 text-right font-medium text-neutral-400">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {populated.map((row) => (
              <tr
                key={row.def.key}
                className={row.def.isSubtotal ? "border-t border-white/[0.06] font-medium" : ""}
              >
                <th scope="row" className="px-3 py-1.5 text-left font-normal align-middle">
                  <Tooltip label={tooltip(`item.${row.def.key}`)}>
                    <span className={row.def.parentKey ? "pl-4 text-neutral-400" : "text-neutral-200"}>
                      {row.def.label}
                    </span>
                  </Tooltip>
                </th>
                {row.cells.map((cell) => (
                  <EditableCell
                    key={cell.periodKey}
                    cell={cell}
                    onCommit={(v) => onEdit(cell.canonicalKey, cell.periodKey, v)}
                    onReset={() => onReset(cell.canonicalKey, cell.periodKey)}
                    onInspect={() => onInspect(cell)}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
