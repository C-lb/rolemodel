"use client";

import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from "react";

interface Props {
  label: string;
  /** Which edge the bubble hangs from. Use "end" for right-aligned content so it cannot run off the page. */
  align?: "start" | "end";
  children: ReactNode;
}

/** Elements that are keyboard-focusable on their own, so the wrapper must not add a second tab stop. */
const FOCUSABLE_TAGS = new Set(["a", "button", "input", "select", "summary", "textarea"]);

interface FocusableProps {
  tabIndex?: number;
  disabled?: boolean;
  "aria-describedby"?: string;
}

/**
 * Is the child already its own tab stop? A button, link or field is, and so is
 * anything given a non-negative tabIndex. Everything else (a span of text, a
 * heading) needs the wrapper to make the tooltip keyboard-reachable.
 */
function focusableChild(node: ReactNode): ReactElement<FocusableProps> | null {
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<FocusableProps>;
  const { tabIndex, disabled } = element.props;
  if (typeof tabIndex === "number") return tabIndex >= 0 ? element : null;
  if (typeof element.type === "string" && FOCUSABLE_TAGS.has(element.type) && !disabled) return element;
  return null;
}

/**
 * Hover- and focus-triggered tooltip. The description lands on whichever element
 * actually takes focus: the child when it is a control, the wrapper otherwise.
 */
export function Tooltip({ label, align = "start", children }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const control = focusableChild(children);
  const describedBy = open ? id : undefined;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={control ? undefined : 0}
      aria-describedby={control ? undefined : describedBy}
    >
      {control ? cloneElement(control, { "aria-describedby": describedBy }) : children}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`pointer-events-none absolute ${align === "end" ? "right-0" : "left-0"} top-full z-50 mt-2 w-72 rounded-md bg-slate-900 p-2.5 text-xs leading-relaxed text-slate-100 shadow-[0_14px_34px_-18px_rgba(0,0,0,0.65)] dark:bg-slate-800`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
