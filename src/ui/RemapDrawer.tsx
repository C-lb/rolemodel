"use client";

import { useDraggable } from "@dnd-kit/core";
import { TAXONOMY } from "@/model/taxonomy";
import { formatMoney } from "./format";
import { Tooltip } from "./Tooltip";
import { tooltip } from "./tooltips";

export interface UnmappedFact {
  id: string;
  label: string;
  periodKey: string;
  value: number;
  page: number | null;
  rawValue: string;
}

interface ChipProps {
  fact: UnmappedFact;
  onRemap: (factId: string, key: string) => void;
}

/** Phosphor DotsSixVertical, the standard grip. */
function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-[1em] shrink-0">
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}

/** The figure as the document printed it, when scaling made it read differently. */
function printedAs(fact: UnmappedFact): string | null {
  const raw = fact.rawValue.trim();
  return raw && raw !== formatMoney(fact.value) ? raw : null;
}

function Chip({ fact, onRemap }: ChipProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: fact.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const printed = printedAs(fact);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-[10px] bg-white/[0.03] px-3 py-2 transition-colors ${
        isDragging ? "z-30 bg-white/[0.07] shadow-[0_18px_40px_-20px_rgba(0,0,0,0.75)]" : ""
      }`}
    >
      {/*
        dnd-kit makes this a real, named button rather than a decoration, so it is
        announced and reachable. It is still the pointer affordance: the select
        beside it is the path that works without one.
      */}
      <span
        {...listeners}
        {...attributes}
        aria-label={`Drag ${fact.label} onto a line item`}
        className="cursor-grab rounded-[10px] p-0.5 text-amber-200/45 transition-colors hover:text-amber-200/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-300 active:cursor-grabbing"
      >
        <GripIcon />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate leading-snug text-amber-50">{fact.label}</p>
        <p className="mt-0.5 truncate text-xs leading-relaxed text-amber-100/60">
          {fact.periodKey} · {formatMoney(fact.value)}
          {printed ? ` (${printed} as printed)` : ""}
          {fact.page !== null ? ` · page ${fact.page}` : ""}
        </p>
      </div>

      <Tooltip label={tooltip("control.remap")} align="end">
        <select
          aria-label={`Move ${fact.label} to a line item`}
          defaultValue=""
          onChange={(e) => {
            const key = e.target.value;
            if (!key) return;
            // Back to "Move to…" straight away. The chip either leaves the drawer
            // or the move was refused, and in the second case the user has to be
            // able to pick that same line again once they have cleared it.
            e.target.value = "";
            onRemap(fact.id, key);
          }}
          className="max-w-[11rem] shrink-0 rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 transition-colors hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-300"
        >
          <option value="" disabled>Move to…</option>
          {TAXONOMY.map((item) => (
            <option key={item.key} value={item.key}>{item.label}</option>
          ))}
        </select>
      </Tooltip>
    </li>
  );
}

interface Props {
  facts: UnmappedFact[];
  onRemap: (factId: string, key: string) => void;
}

export function RemapDrawer({ facts, onRemap }: Props) {
  if (facts.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-amber-900/40 bg-amber-950/20 px-4 py-3.5 text-sm text-amber-100">
      <div className="min-w-0">
        <h2 className="font-medium leading-snug">
          {facts.length} figure{facts.length === 1 ? "" : "s"} could not be mapped
        </h2>
        <p className="mt-1 max-w-[68ch] text-xs leading-relaxed text-amber-100/70">
          Drag one onto the right line in a statement below, or pick a line from its dropdown.
          Until then these are left out of every total.
        </p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {facts.map((fact) => (
          <Chip key={fact.id} fact={fact} onRemap={onRemap} />
        ))}
      </ul>
    </section>
  );
}
