"use client";

import { useMemo, useState } from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { TAXONOMY, type StatementKind } from "@/model/taxonomy";
import { RATIOS } from "@/model/ratios/library";
import { parseExpression } from "@/model/ratios/expression";
import type { RatioPeriodResult } from "@/model/ratios/compute";
import { formatRatio } from "./format";
import { Tooltip } from "./Tooltip";
import { tooltip } from "./tooltips";

export interface RatioDraft {
  label: string;
  expression: string;
  note: string | null;
}

interface Props {
  onPreview: (expression: string) => RatioPeriodResult[];
  onSave: (draft: RatioDraft) => void;
  onCancel: () => void;
  /** What the server said about the last attempt, if it refused one. */
  saveError: string | null;
  initial?: { label: string; expression: string; note: string | null };
}

const STATEMENT_TITLES: Record<StatementKind, string> = {
  income: "Income statement",
  balance: "Balance sheet",
  cashflow: "Cash flow",
};

const OPERATORS = [
  { symbol: "+", name: "add" },
  { symbol: "-", name: "subtract" },
  { symbol: "*", name: "multiply" },
  { symbol: "/", name: "divide" },
  { symbol: "(", name: "open bracket" },
  { symbol: ")", name: "close bracket" },
] as const;

const DROP_TARGET = "ratio-expression";

/**
 * Appends a token with exactly one space between it and whatever came before, so a chip
 * added after a hand-typed operator reads as one expression rather than two run together.
 */
function appendToken(expression: string, token: string): string {
  const trimmed = expression.trimEnd();
  if (trimmed === "") return token;
  if (trimmed.endsWith("(")) return `${trimmed}${token}`;
  return `${trimmed} ${token}`;
}

function Chip({ name, label, onAdd }: { name: string; label: string; onAdd: (name: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `chip:${name}` });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <li ref={setNodeRef} style={style} className={isDragging ? "z-30" : ""}>
      {/*
        The button is the whole chip: pressing it appends the token, and dragging it does
        the same thing by another route. Drag is the convenience; the button is the path
        that works from the keyboard.
      */}
      <button
        type="button"
        {...listeners}
        {...attributes}
        onClick={() => onAdd(name)}
        aria-label={`Add ${label} to the expression`}
        className={`max-w-[14rem] cursor-grab truncate whitespace-nowrap rounded-[10px] border border-white/10 px-3 py-1.5 text-xs leading-relaxed text-neutral-300 transition-colors hover:bg-white/[0.06] hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 active:cursor-grabbing ${
          isDragging ? "bg-white/[0.08]" : ""
        }`}
      >
        {label}
      </button>
    </li>
  );
}

export function RatioBuilder({ onPreview, onSave, onCancel, saveError, initial }: Props) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [expression, setExpression] = useState(initial?.expression ?? "");
  const [note, setNote] = useState(initial?.note ?? "");

  const { setNodeRef, isOver } = useDroppable({ id: DROP_TARGET });

  // A drag needs a few pixels of travel before it starts. Without the constraint dnd-kit
  // claims the pointer on press and the chip's own click never fires, which silently
  // breaks the button path that makes this usable without a pointer at all.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const parsed = useMemo(() => parseExpression(expression), [expression]);
  const preview = useMemo(
    () => (parsed.ok ? onPreview(expression) : []),
    [parsed.ok, expression, onPreview],
  );

  const nameGiven = label.trim() !== "";
  const canSave = nameGiven && parsed.ok;

  const add = (token: string) => setExpression((current) => appendToken(current, token));

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over?.id !== DROP_TARGET) return;
    const id = String(event.active.id);
    if (!id.startsWith("chip:")) return;
    add(id.slice("chip:".length));
  };

  const missing = [...new Set(preview.flatMap((period) => period.missing))];

  return (
    <DndContext id="ratio-builder" sensors={sensors} onDragEnd={handleDragEnd}>
      <section className="flex flex-col gap-4 rounded-2xl border border-white/[0.06] bg-neutral-900/60 p-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium leading-snug text-neutral-200">
            {initial ? "Edit ratio" : "New ratio"}
          </h2>
          <p className="mt-1 max-w-[68ch] text-xs leading-relaxed text-neutral-500">
            Drag a line item into the expression, or press it to add it. You can also type the
            expression directly. Line items, numbers, brackets and the four operators are allowed.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ratio-name" className="block text-xs leading-relaxed text-neutral-400">
            Name
          </label>
          <input
            id="ratio-name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="R&D intensity"
            className="w-full rounded-[10px] border border-white/10 bg-neutral-950 px-3 py-2 text-sm leading-relaxed text-neutral-100 transition-colors placeholder:text-neutral-600 hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ratio-expression" className="block text-xs leading-relaxed text-neutral-400">
            Expression
          </label>
          <Tooltip label={tooltip("control.ratio_expression")}>
            <textarea
              id="ratio-expression"
              ref={setNodeRef}
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              rows={2}
              placeholder="research_development / revenue"
              className={`w-full resize-y rounded-[10px] border bg-neutral-950 px-3 py-2 font-mono text-sm leading-relaxed text-neutral-100 transition-colors placeholder:text-neutral-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 ${
                isOver ? "border-neutral-400" : "border-white/10 hover:border-white/20"
              }`}
            />
          </Tooltip>
          {!parsed.ok && expression.trim() !== "" && (
            <p className="text-xs leading-relaxed text-amber-200/80">
              {parsed.error.message} Check character {parsed.error.offset + 1}.
            </p>
          )}
          {saveError && <p className="text-xs leading-relaxed text-red-300">{saveError}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          {OPERATORS.map((operator) => (
            <button
              key={operator.symbol}
              type="button"
              onClick={() => add(operator.symbol)}
              aria-label={operator.name}
              className="w-10 whitespace-nowrap rounded-[10px] border border-white/10 px-3 py-1.5 font-mono text-xs text-neutral-300 transition-colors hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
            >
              {operator.symbol}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          {(Object.keys(STATEMENT_TITLES) as StatementKind[]).map((statement) => (
            <div key={statement} className="flex flex-col gap-1.5">
              <p className="text-xs leading-relaxed text-neutral-500">{STATEMENT_TITLES[statement]}</p>
              <Tooltip label={tooltip("control.ratio_chip")}>
                <ul className="flex flex-wrap gap-1.5">
                  {TAXONOMY.filter((item) => item.statement === statement).map((item) => (
                    <Chip key={item.key} name={item.key} label={item.label} onAdd={add} />
                  ))}
                </ul>
              </Tooltip>
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs leading-relaxed text-neutral-500">Ratios</p>
            <ul className="flex flex-wrap gap-1.5">
              {RATIOS.map((r) => (
                <Chip key={r.key} name={r.key} label={r.label} onAdd={add} />
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ratio-note" className="block text-xs leading-relaxed text-neutral-400">
            Note
          </label>
          <input
            id="ratio-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What you want this to tell you"
            className="w-full rounded-[10px] border border-white/10 bg-neutral-950 px-3 py-2 text-sm leading-relaxed text-neutral-100 transition-colors placeholder:text-neutral-600 hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
          />
        </div>

        {parsed.ok && preview.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-white/[0.06] pt-3">
            <p className="text-xs leading-relaxed text-neutral-500">Preview</p>
            <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs leading-relaxed">
              {preview.map((period) => (
                <div key={period.periodKey} className="flex items-baseline gap-2">
                  <dt className="text-neutral-500">{period.periodKey}</dt>
                  <dd className="tabular-nums text-neutral-300">
                    {period.state === "ok" && period.value !== undefined
                      ? formatRatio(period.value, "x")
                      : "—"}
                  </dd>
                </div>
              ))}
            </dl>
            {missing.length > 0 && (
              <p className="max-w-[68ch] text-xs leading-relaxed text-amber-200/80">
                No value yet: the statements have no figure for{" "}
                {missing
                  .map((key) => TAXONOMY.find((i) => i.key === key)?.label ?? key)
                  .join(", ")}
                .
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!canSave}
            onClick={() =>
              onSave({ label: label.trim(), expression: expression.trim(), note: note.trim() || null })
            }
            className="whitespace-nowrap rounded-[10px] bg-neutral-200 px-4 py-2 text-xs font-medium text-neutral-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
          >
            Save ratio
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="whitespace-nowrap rounded-[10px] border border-white/10 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
          >
            Cancel
          </button>
        </div>
      </section>
    </DndContext>
  );
}
