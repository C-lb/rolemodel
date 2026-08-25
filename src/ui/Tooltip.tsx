"use client";

import { useId, useState, type ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
}

/** Hover- and focus-triggered tooltip. Focusable so it is reachable by keyboard. */
export function Tooltip({ label, children }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          id={id}
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-72 rounded-md bg-slate-900 p-2.5 text-xs leading-relaxed text-slate-100 shadow-[0_14px_34px_-18px_rgba(0,0,0,0.65)] dark:bg-slate-800"
        >
          {label}
        </span>
      )}
    </span>
  );
}
