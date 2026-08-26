"use client";

import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
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
  /**
   * Show every line in the taxonomy, not just the ones that hold a figure. Set
   * while a chip is being dragged, so an empty line is still somewhere to drop it.
   */
  revealEmptyRows?: boolean;
}

const ROW_TARGET_PREFIX = "row:";

/**
 * The line item a chip was dropped on, or null if it was not dropped on one.
 * Drop target ids are namespaced, so this is what stops a drop onto anything
 * else on the page from being read as a line item and sent to the server.
 */
export function droppedRowKey(overId: string | number | undefined): string | null {
  if (overId === undefined) return null;
  const id = String(overId);
  if (!id.startsWith(ROW_TARGET_PREFIX)) return null;
  const key = id.slice(ROW_TARGET_PREFIX.length);
  return key === "" ? null : key;
}

/** The label cell doubles as the drop target for an unmapped figure. */
function LabelCell({ rowKey, children }: { rowKey: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${ROW_TARGET_PREFIX}${rowKey}` });
  return (
    <th
      ref={setNodeRef}
      scope="row"
      className={`px-3 py-1.5 text-left align-middle font-normal transition-colors ${
        isOver ? "bg-sky-500/15" : ""
      }`}
    >
      {children}
    </th>
  );
}

export function StatementTable({ title, rows, periods, onEdit, onReset, onInspect, revealEmptyRows }: Props) {
  const populated = rows.filter((r) => r.cells.some((c) => c.value !== undefined));
  // A statement with nothing in it is hidden, except mid-drag: a figure has to be
  // droppable onto a cash-flow line even when the extractor found no cash flow.
  if (populated.length === 0 && !revealEmptyRows) return null;
  const visible = revealEmptyRows ? rows : populated;

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
            {visible.map((row) => (
              <tr
                key={row.def.key}
                className={row.def.isSubtotal ? "border-t border-white/[0.06] font-medium" : ""}
              >
                <LabelCell rowKey={row.def.key}>
                  <Tooltip label={tooltip(`item.${row.def.key}`)}>
                    <span className={row.def.parentKey ? "pl-4 text-neutral-400" : "text-neutral-200"}>
                      {row.def.label}
                    </span>
                  </Tooltip>
                </LabelCell>
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
