"use client";

import { useState, type ReactNode } from "react";

interface Props {
  title: string;
  /** How many cards are inside, so a collapsed section still says what it holds. */
  count: number;
  children: ReactNode;
}

/**
 * One family of ratios. Collapsible because 25 cards is a long scroll, and a reader
 * working on liquidity should be able to put leverage away.
 */
export function RatioSection({ title, count, children }: Props) {
  const [open, setOpen] = useState(true);
  if (count === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-fit items-center gap-2 rounded-[10px] py-1 text-sm font-medium leading-snug text-neutral-300 transition-colors hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`size-[0.85em] text-neutral-500 transition-transform ${open ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="whitespace-nowrap">{title}</span>
        <span className="tabular-nums text-neutral-500">{count}</span>
      </button>

      {open && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
      )}
    </section>
  );
}
