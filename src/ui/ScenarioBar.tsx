"use client";

import { useState } from "react";
import { tooltip } from "./tooltips";
import { Tooltip } from "./Tooltip";

export interface ScenarioTab {
  id: string;
  name: string;
  isBase: boolean;
}

interface Props {
  scenarios: ScenarioTab[];
  activeId: string;
  /** 1..5 (spec §4, "adjustable one to five"). Out-of-range input is clamped before the callback fires. */
  horizon: number;
  onSelect: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onHorizonChange: (horizon: number) => void;
}

const MIN_HORIZON = 1;
const MAX_HORIZON = 5;

function clampHorizon(value: number): number {
  if (!Number.isFinite(value)) return MIN_HORIZON;
  return Math.min(MAX_HORIZON, Math.max(MIN_HORIZON, Math.round(value)));
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-[0.9em]">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-[0.9em]">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-[0.9em]">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-[0.9em]">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** A small icon-only control for a tab's own affordances, styled to sit inside the tab without competing with its label. */
function TabIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="rounded-[10px] p-1 text-neutral-500 transition-colors hover:bg-white/10 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
    >
      {children}
    </button>
  );
}

export function ScenarioBar({
  scenarios,
  activeId,
  horizon,
  onSelect,
  onAdd,
  onRename,
  onDuplicate,
  onDelete,
  onHorizonChange,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [horizonDraft, setHorizonDraft] = useState(String(horizon));
  // Tracks the `horizon` this draft was last synced to, so a prop change can be
  // detected and applied during render (React's own "adjust state when a prop
  // changes" pattern) rather than in a useEffect, which would commit the stale value
  // for one paint and then cascade a second render to fix it.
  const [syncedHorizon, setSyncedHorizon] = useState(horizon);

  // `horizonDraft` is otherwise only ever written by the user typing or by
  // `commitHorizon`'s own clamp: if the parent rejects a change, resets it (a scenario
  // switch, an undo), or clamps it differently than this component would, the field
  // would show a stale number forever without this resync.
  if (horizon !== syncedHorizon) {
    setSyncedHorizon(horizon);
    setHorizonDraft(String(horizon));
  }

  function commitAdd() {
    const trimmed = draftName.trim();
    if (trimmed !== "") onAdd(trimmed);
    setDraftName("");
    setAdding(false);
  }

  function commitRename(id: string) {
    const trimmed = renameDraft.trim();
    if (trimmed !== "") onRename(id, trimmed);
    setRenamingId(null);
  }

  function commitHorizon() {
    const parsed = Number(horizonDraft);
    const clamped = clampHorizon(parsed);
    setHorizonDraft(String(clamped));
    onHorizonChange(clamped);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
      <div aria-label="Scenarios" className="flex flex-wrap items-center gap-1.5">
        {scenarios.map((s) => {
          const active = s.id === activeId;
          const renaming = renamingId === s.id;
          // The base scenario's status has to reach an accessible name somewhere: a
          // visible "(base)" suffix inside the button is fine for a sighted user, but
          // that text is silent to a screen reader once the button also carries a
          // more specific aria-label, so the status is folded into the label itself.
          const selectLabel = s.isBase ? `${s.name}, base scenario` : s.name;

          if (renaming) {
            return (
              <span key={s.id} className="inline-flex items-center gap-1 rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1">
                <label className="sr-only" htmlFor={`rename-${s.id}`}>Rename {s.name}</label>
                <input
                  id={`rename-${s.id}`}
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(s.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className="w-28 rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
                />
                <button
                  type="button"
                  onClick={() => commitRename(s.id)}
                  className="whitespace-nowrap rounded-[10px] border border-white/10 px-3 py-1 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10"
                >
                  Save
                </button>
              </span>
            );
          }

          return (
            <span
              key={s.id}
              className={[
                "inline-flex items-center gap-1 whitespace-nowrap rounded-[10px] border px-1.5 py-1 text-sm font-medium transition-colors",
                active
                  ? "border-sky-400/40 bg-sky-500/10 text-sky-200"
                  : "border-white/10 text-neutral-300",
              ].join(" ")}
            >
              {/*
                A plain button with aria-current, not the ARIA tabs pattern: this list
                has no roving tabindex and no tabpanel, so claiming role="tab" would
                promise keyboard behaviour it doesn't deliver. A button carrying
                aria-current="true" is the honest, simpler shape for "select this one
                of several", and it also can't have another button nested inside it the
                way a single "tab" element could.
              */}
              <Tooltip label={tooltip("control.scenario_tab")}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  aria-label={selectLabel}
                  onClick={() => onSelect(s.id)}
                  onKeyDown={(e) => {
                    // Real browsers already turn Enter/Space into a click for a native
                    // button; this is belt-and-braces for the same reason the rest of
                    // this file's controls are explicit about it.
                    if (e.key === "Enter") { e.preventDefault(); onSelect(s.id); }
                  }}
                  className="rounded-[8px] px-1.5 py-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  {s.name}
                  {s.isBase && <span aria-hidden="true" className="ml-1.5 text-xs text-neutral-500">(base)</span>}
                </button>
              </Tooltip>
              <Tooltip label={tooltip("control.scenario_rename")}>
                <TabIconButton
                  label={`Rename ${s.name}`}
                  onClick={() => { setRenameDraft(s.name); setRenamingId(s.id); }}
                >
                  <PencilIcon />
                </TabIconButton>
              </Tooltip>
              <Tooltip label={tooltip("control.scenario_duplicate")}>
                <TabIconButton label={`Duplicate ${s.name}`} onClick={() => onDuplicate(s.id)}>
                  <CopyIcon />
                </TabIconButton>
              </Tooltip>
              {!s.isBase && (
                <Tooltip label={tooltip("control.scenario_delete")}>
                  <TabIconButton label={`Delete ${s.name}`} onClick={() => onDelete(s.id)}>
                    <TrashIcon />
                  </TabIconButton>
                </Tooltip>
              )}
            </span>
          );
        })}

        {adding ? (
          <span className="inline-flex items-center gap-1 rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1">
            <label className="sr-only" htmlFor="new-scenario-name">New scenario name</label>
            <input
              id="new-scenario-name"
              autoFocus
              aria-label="New scenario name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitAdd();
                if (e.key === "Escape") { setAdding(false); setDraftName(""); }
              }}
              className="w-28 rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
            />
            <button
              type="button"
              onClick={commitAdd}
              className="whitespace-nowrap rounded-[10px] border border-white/10 px-3 py-1 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10"
            >
              Create
            </button>
          </span>
        ) : (
          <Tooltip label={tooltip("control.scenario_add")}>
            <button
              type="button"
              onClick={() => setAdding(true)}
              aria-label="Add scenario"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-white/10 px-3 py-1.5 text-sm font-medium text-neutral-300 transition-colors hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              <PlusIcon />
              Add scenario
            </button>
          </Tooltip>
        )}
      </div>

      <Tooltip label={tooltip("control.scenario_horizon")} align="end">
        <span className="inline-flex items-center gap-2 text-sm text-neutral-400">
          <label htmlFor="forecast-horizon" className="whitespace-nowrap">Forecast horizon</label>
          <input
            id="forecast-horizon"
            aria-label="Forecast horizon, one to five periods"
            type="number"
            min={MIN_HORIZON}
            max={MAX_HORIZON}
            value={horizonDraft}
            onChange={(e) => setHorizonDraft(e.target.value)}
            onBlur={commitHorizon}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            className="w-14 rounded-[10px] border border-white/10 bg-neutral-900 px-2 py-1 text-right text-sm tabular-nums text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          />
        </span>
      </Tooltip>
    </div>
  );
}
