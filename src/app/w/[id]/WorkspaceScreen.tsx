"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { StatementRow, Cell } from "@/model/workspace";
import type { Finding } from "@/model/validate";
import { StatementTable, droppedRowKey } from "@/ui/StatementTable";
import { RemapDrawer, type UnmappedFact } from "@/ui/RemapDrawer";
import { ProvenancePanel } from "@/ui/ProvenancePanel";
import { Banner } from "@/ui/Banner";
import { useToast } from "@/ui/ToastProvider";
import { tooltip } from "@/ui/tooltips";
import { UNMAPPED_KEY } from "@/model/taxonomy";
import { saveOverride, clearOverride, remapLineItem } from "@/app/actions";

interface Statements {
  income: StatementRow[];
  balance: StatementRow[];
  cashflow: StatementRow[];
}

interface Props {
  workspaceId: string;
  documentName: string;
  periods: string[];
  findings: Finding[];
  statements: Statements;
  unmapped: UnmappedFact[];
}

type SaveResult = Awaited<ReturnType<typeof saveOverride>>;

interface SaveFailure {
  message: string;
  remediation: string;
  retry: () => void;
}

const STATEMENT_TITLES: [keyof Statements, string][] = [
  ["income", "Income statement"],
  ["balance", "Balance sheet"],
  ["cashflow", "Cash flow"],
];

const cellId = (key: string, period: string) => `${key}::${period}`;

/**
 * Identity of one finding. Several findings share a code and a period (one per
 * subtotal, one per conflicting cell, one per missing statement), so the keys
 * they carry are what tells them apart. Dismissing one must not hide its siblings.
 */
const findingId = (f: Finding) => `${f.code}:${f.periodKey}:${f.keys.join(",")}`;


export function WorkspaceScreen({ workspaceId, documentName, periods, findings, statements, unmapped }: Props) {
  const [inspected, setInspected] = useState<Cell | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  // A drag needs a few pixels of travel before it starts, so a click on the grip
  // is still a click. The keyboard sensor keeps a picked-up figure movable without
  // a mouse; the dropdown on each chip is the plain, complete keyboard path.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  // One index over every cell on screen, so the previous value behind an edit is
  // looked up in one place rather than re-scanned per statement.
  const cells = useMemo(() => {
    const index = new Map<string, Cell>();
    for (const rows of Object.values(statements)) {
      for (const row of rows) {
        for (const cell of row.cells) index.set(cellId(cell.canonicalKey, cell.periodKey), cell);
      }
    }
    return index;
  }, [statements]);

  /**
   * Run one persistence action. A failure raises a blocking banner carrying the
   * action's own remediation and a retry of exactly the attempt that failed, so
   * a save that did not land can never read as one that did.
   */
  function perform(action: () => Promise<SaveResult>, onSaved: () => void) {
    const run = () => startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setSaveFailure({ message: result.message, remediation: result.remediation, retry: run });
        return;
      }
      setSaveFailure(null);
      router.refresh();
      onSaved();
    });

    run();
  }

  /** Put a cell back the way it was: the user's earlier figure, or the extracted one. */
  function restore(key: string, period: string, previous: number | undefined) {
    perform(
      () => (previous === undefined
        ? clearOverride(workspaceId, key, period)
        : saveOverride(workspaceId, key, period, previous)),
      () => {},
    );
  }

  function edit(key: string, period: string, value: number) {
    const before = cells.get(cellId(key, period));
    const previousOverride = before?.source === "override" ? before.value : undefined;

    perform(
      () => saveOverride(workspaceId, key, period, value),
      () => toast.show("Value updated", { undo: () => restore(key, period, previousOverride) }),
    );
  }

  function reset(key: string, period: string) {
    const discarded = cells.get(cellId(key, period))?.value;

    perform(
      () => clearOverride(workspaceId, key, period),
      () => toast.show("Restored the extracted value", {
        undo: discarded === undefined ? undefined : () => restore(key, period, discarded),
      }),
    );
  }

  /**
   * Move one figure to a line item. A refusal (the target line already holds a
   * value for that period) is the user's request being declined, not a save
   * that went missing, so it reads as a toast rather than a blocking banner.
   */
  function remap(factId: string, toKey: string, undone = false) {
    startTransition(async () => {
      const result = await remapLineItem(workspaceId, factId, toKey);
      if (!result.ok) {
        toast.show(result.message);
        return;
      }
      router.refresh();
      if (undone) {
        toast.show("Moved back to unmapped");
        return;
      }
      toast.show("Line item moved", { undo: () => remap(factId, UNMAPPED_KEY, true) });
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(false);
    const toKey = droppedRowKey(event.over?.id);
    if (toKey === null) return;
    remap(String(event.active.id), toKey);
  }

  const visible = findings.filter((f) => !dismissed.has(findingId(f)));
  const hasFigures = STATEMENT_TITLES.some(([kind]) =>
    statements[kind].some((row) => row.cells.some((c) => c.value !== undefined)),
  );

  return (
    <DndContext
      // A fixed id: without one, dnd-kit numbers its screen-reader description
      // elements from a global counter that differs between the server render
      // and the client one, and React reports the mismatch on hydration.
      id="workspace-remap"
      sensors={sensors}
      onDragStart={() => setDragging(true)}
      onDragCancel={() => setDragging(false)}
      onDragEnd={handleDragEnd}
    >
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-2">
          <span className="block text-xs leading-snug text-neutral-500">Extracted statements</span>
          <h1 className="min-w-0 break-words text-xl font-semibold leading-snug text-neutral-100">{documentName}</h1>
          <p className="max-w-[68ch] text-sm leading-relaxed text-neutral-400">
            {periods.length} period{periods.length === 1 ? "" : "s"}. Double-click a figure to edit it, or
            press Enter on it. A single click, or Space, shows where it came from.
          </p>
        </header>

        {saveFailure && (
          <Banner
            severity="blocking"
            title="That edit was not saved"
            message={saveFailure.message}
            remediation={saveFailure.remediation}
            actionLabel="Try again"
            // The control goes away while a retry is in flight: Banner renders no
            // button without a handler, which is how it says "not now" here.
            onAction={pending ? undefined : saveFailure.retry}
          />
        )}

        {visible.length > 0 && (
          <div className="flex flex-col gap-2">
            {visible.map((f) => (
              <Banner
                key={findingId(f)}
                severity={f.severity}
                title={f.message}
                titleHelp={tooltip(`finding.${f.code}`)}
                remediation={f.remediation}
                onDismiss={f.severity === "warning"
                  ? () => setDismissed((prev) => new Set(prev).add(findingId(f)))
                  : undefined}
              />
            ))}
          </div>
        )}

        <RemapDrawer facts={unmapped} onRemap={(factId, key) => remap(factId, key)} />

        {hasFigures ? (
          STATEMENT_TITLES.map(([kind, title]) => (
            <StatementTable
              key={kind}
              title={title}
              rows={statements[kind]}
              periods={periods}
              onEdit={edit}
              onReset={reset}
              onInspect={setInspected}
              revealEmptyRows={dragging}
            />
          ))
        ) : (
          <p className="max-w-[68ch] text-sm leading-relaxed text-neutral-400">
            No figures were extracted from this document, so there is nothing to show yet.
          </p>
        )}

        {inspected && (
          <ProvenancePanel cell={inspected} documentName={documentName} onClose={() => setInspected(null)} />
        )}
      </main>
    </DndContext>
  );
}
