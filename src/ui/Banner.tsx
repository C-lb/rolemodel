"use client";

import { Tooltip } from "./Tooltip";
import { tooltip } from "./tooltips";

interface Props {
  severity: "blocking" | "warning";
  title: string;
  /** Background on what the title means. Shown on hover and focus rather than inline, so a headline that repeats across sibling banners does not repeat its explanation with it. */
  titleHelp?: string;
  message?: string;
  remediation: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}

const TONE = {
  blocking: {
    role: "alert" as const,
    wrap: "border-red-900/40 bg-red-950/30 text-red-100",
    icon: "text-red-400",
  },
  warning: {
    role: "status" as const,
    wrap: "border-amber-900/40 bg-amber-950/20 text-amber-100",
    icon: "text-amber-400",
  },
};

export function Banner({ severity, title, titleHelp, message, remediation, actionLabel, onAction, onDismiss }: Props) {
  const tone = TONE[severity];
  return (
    <div role={tone.role} className={`flex gap-3 rounded-xl border px-4 py-3.5 text-sm ${tone.wrap}`}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`mt-0.5 size-[1.15em] shrink-0 ${tone.icon}`}
      >
        {severity === "blocking" ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="8" x2="12" y2="13" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </>
        ) : (
          <>
            <path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </>
        )}
      </svg>

      <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          {titleHelp ? (
            <Tooltip label={titleHelp}>
              <p className="font-medium leading-snug">{title}</p>
            </Tooltip>
          ) : (
            <p className="font-medium leading-snug">{title}</p>
          )}
          {message && <p className="mt-1 leading-relaxed text-current/85">{message}</p>}
          <p className="mt-1.5 text-xs leading-relaxed text-current/70">{remediation}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="whitespace-nowrap rounded-[10px] border border-current/30 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-current/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            >
              {actionLabel}
            </button>
          )}
          {onDismiss && (
            <Tooltip label={tooltip("control.dismiss_banner")} align="end">
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss"
                className="rounded-[10px] p-1 text-current/70 transition-colors hover:bg-current/10 hover:text-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-[1em]">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
