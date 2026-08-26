"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Cell } from "@/model/workspace";
import { lineItem } from "@/model/taxonomy";
import { formatMoney, parseMoney } from "./format";
import { tooltip } from "./tooltips";
import { Tooltip } from "./Tooltip";

interface Props {
  cell: Cell;
  onCommit: (value: number) => void;
  onReset: () => void;
  onInspect: () => void;
}

/**
 * How long a single pointer click waits before it counts as an inspect. A second
 * click inside this window is a double click, which edits instead, so the two
 * gestures never both fire on one figure.
 */
const DOUBLE_CLICK_WINDOW_MS = 250;

const LOW_CONFIDENCE = 0.6;

export function EditableCell({ cell, onCommit, onReset, onInspect }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const pendingInspect = useRef<ReturnType<typeof setTimeout> | null>(null);
  const figureRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const settled = useRef(false);
  const hintId = useId();

  useEffect(() => () => {
    if (pendingInspect.current !== null) clearTimeout(pendingInspect.current);
  }, []);

  // Closing the editor unmounts the input, so put focus back on the figure
  // rather than dropping the keyboard user at the top of the document.
  useEffect(() => {
    if (wasEditing.current && !editing) figureRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function cancelPendingInspect() {
    if (pendingInspect.current === null) return;
    clearTimeout(pendingInspect.current);
    pendingInspect.current = null;
  }

  function startEditing() {
    cancelPendingInspect();
    settled.current = false;
    setDraft(cell.value === undefined ? "" : String(cell.value));
    setInvalid(false);
    setEditing(true);
  }

  /**
   * Browsers fire blur when the focused input is removed, and blur commits. So
   * both ways out of the editor blur it first behind this flag: without that,
   * Escape would save the draft and Enter would save it twice.
   */
  function settle(input: HTMLInputElement) {
    settled.current = true;
    input.blur();
    setEditing(false);
  }

  function cancelEditing(input: HTMLInputElement) {
    settle(input);
    setInvalid(false);
  }

  function commit(input: HTMLInputElement) {
    if (settled.current) return;
    const parsed = parseMoney(draft);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    settle(input);
    onCommit(parsed);
  }

  const label = lineItem(cell.canonicalKey)?.label ?? cell.canonicalKey;

  if (editing) {
    return (
      <td className="px-2 py-1.5 text-right align-middle">
        <input
          autoFocus
          aria-label={`Edit ${label} for ${cell.periodKey}`}
          aria-invalid={invalid}
          aria-describedby={invalid ? hintId : undefined}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
          onBlur={(e) => commit(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(e.currentTarget);
            if (e.key === "Escape") cancelEditing(e.currentTarget);
          }}
          className={[
            "w-28 rounded-[10px] border bg-neutral-900 px-2 py-1 text-right text-sm tabular-nums text-neutral-100",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
            invalid
              ? "border-red-500/60 focus-visible:outline-red-400"
              : "border-white/10 focus-visible:outline-sky-400",
          ].join(" ")}
        />
        {invalid && (
          <p id={hintId} className="mt-1 text-right text-xs leading-snug text-red-400">
            Enter a plain number, like 1,250 or (1,250).
          </p>
        )}
      </td>
    );
  }

  const lowConfidence =
    cell.source === "extracted" && cell.confidence !== undefined && cell.confidence < LOW_CONFIDENCE;

  return (
    <td className="px-2 py-1.5 text-right align-middle">
      <span className="inline-flex items-center justify-end gap-1.5">
        {lowConfidence && (
          <Tooltip label={tooltip("control.confidence_badge")} align="end">
            <span className="inline-flex items-center text-amber-400">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-[0.9em] align-middle"
              >
                <path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="sr-only">Low confidence</span>
            </span>
          </Tooltip>
        )}

        <Tooltip label={tooltip("control.provenance")} align="end">
          <button
            ref={figureRef}
            type="button"
            aria-label={`${label}, ${cell.periodKey}: ${formatMoney(cell.value)}`}
            onClick={(e) => {
              // A keyboard activation carries no click count, so it inspects at once.
              if (e.detail === 0) { onInspect(); return; }
              // A pointer click waits: the second click of a double click cancels it.
              if (pendingInspect.current !== null) return;
              pendingInspect.current = setTimeout(() => {
                pendingInspect.current = null;
                onInspect();
              }, DOUBLE_CLICK_WINDOW_MS);
            }}
            onDoubleClick={startEditing}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              startEditing();
            }}
            className={[
              "rounded-[10px] px-1.5 py-0.5 tabular-nums transition-colors",
              "hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400",
              cell.source === "override" ? "text-sky-300 underline decoration-dotted underline-offset-4" : "text-neutral-200",
              cell.value === undefined ? "text-neutral-500" : "",
            ].join(" ")}
          >
            {formatMoney(cell.value)}
          </button>
        </Tooltip>

        {cell.source === "override" && (
          <Tooltip label={tooltip("control.reset_cell")} align="end">
            <button
              type="button"
              onClick={onReset}
              aria-label="Reset to extracted value"
              className="rounded-[10px] p-1 text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-[0.85em] align-middle"
              >
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
            </button>
          </Tooltip>
        )}
      </span>
    </td>
  );
}
