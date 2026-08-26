"use client";

import { useEffect, useRef } from "react";
import type { Cell } from "@/model/workspace";
import { lineItem, UNMAPPED_KEY } from "@/model/taxonomy";
import { formatMoney } from "./format";
import { tooltip } from "./tooltips";
import { Tooltip } from "./Tooltip";

interface Props {
  cell: Cell;
  documentName: string;
  onClose: () => void;
  /** Discard the user's value for this cell. The same path the grid's reset uses. */
  onReset: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/[0.06] py-2 text-sm leading-relaxed">
      <span className="shrink-0 text-neutral-400">{label}</span>
      <span className="min-w-0 break-words text-right text-neutral-100">{value}</span>
    </div>
  );
}

export function ProvenancePanel({ cell, documentName, onClose, onReset }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Hand focus to the panel, then give it back to the figure that opened it,
    // so a keyboard user does not land on the body when the panel closes.
    const opener = document.activeElement;
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [onClose]);

  const def = lineItem(cell.canonicalKey);
  const p = cell.provenance;

  return (
    <>
      {/* Dims the statements behind the panel so the overlap reads as deliberate, and closes on click. */}
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-black/40" />
      <aside
      role="dialog"
      aria-label={`Source of ${def?.label ?? cell.canonicalKey} for ${cell.periodKey}`}
      className="fixed right-0 top-0 z-40 flex h-full w-[22rem] max-w-full flex-col gap-5 overflow-y-auto border-l border-white/[0.06] bg-neutral-900 p-5 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.75)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-xs leading-snug text-neutral-500">Where this figure came from</span>
          <Tooltip label={tooltip(`item.${def ? def.key : UNMAPPED_KEY}`)}>
            <h2 className="mt-1 text-base font-medium leading-snug text-neutral-100">
              {def?.label ?? cell.canonicalKey}
            </h2>
          </Tooltip>
          <p className="mt-1 text-xs text-neutral-500">{cell.periodKey}</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-[10px] p-1.5 text-neutral-400 transition-colors hover:bg-white/5 hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-[1em]">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {!p ? (
        <p className="max-w-[46ch] text-sm leading-relaxed text-neutral-400">
          {cell.source === "override"
            ? "You entered this value. It was not present in the source document, so there is nothing to trace."
            : "No figure was extracted for this line and period."}
        </p>
      ) : (
        <div>
          <Row label="Document" value={documentName} />
          <Row label={p.page !== null ? "Page" : "Sheet"} value={p.page !== null ? String(p.page) : (p.sheet ?? "—")} />
          <Row label="Position" value={p.locator || "—"} />
          <Row label="Label as printed" value={p.rawLabel} />
          <Row label="Value as printed" value={p.rawValue} />
          <Row label="Scale applied" value={p.scaleFactor === 1 ? "none (stated in units)" : `× ${p.scaleFactor.toLocaleString("en-US")}`} />
          <Row label="Scale evidence" value={p.scaleEvidence || "not stated in the document"} />
          <Row label="Shown in parentheses" value={p.signFlipped ? "yes, treated as negative" : "no"} />
          <Row label="Extracted value" value={formatMoney(cell.extractedValue)} />
          <Row label="Confidence" value={cell.confidence === undefined ? "—" : `${Math.round(cell.confidence * 100)}%`} />
          {cell.source === "override" && <Row label="Your value" value={formatMoney(cell.value)} />}

          {cell.source === "override" && (
            <div className="pt-4">
              <Tooltip label={tooltip("control.reset_cell")}>
                <button
                  type="button"
                  onClick={onReset}
                  className="inline-flex items-center gap-2 whitespace-nowrap rounded-[10px] border border-white/10 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-[1em] align-middle"
                  >
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  Reset to extracted value
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      )}
      </aside>
    </>
  );
}
