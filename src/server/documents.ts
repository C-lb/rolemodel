import path from "node:path";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { ingest, IngestError, type IngestedDocument } from "@/ingest";
import { extractDocument, ExtractionFailedError, type ClaudeCaller } from "@/extract/extract";
import { PROMPT_VERSION } from "@/extract/prompt";
import { MODEL_ID } from "@/extract/client";
import { buildWorkspace, type WorkspaceView } from "@/model/workspace";
import { UNMAPPED_KEY } from "@/model/taxonomy";

export interface Deps {
  db: Db;
  call: ClaudeCaller;
  now: () => number;
  newId: () => string;
  writeFile: (filePath: string, bytes: Buffer) => Promise<void>;
  dataDir: string;
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; remediation: string };

const GENERIC_REMEDIATION =
  "Try the upload again. If it keeps failing, check the terminal running the app for the full error.";

const REMEDIATION: Record<string, string> = {
  unsupported_type: "Upload a PDF (.pdf) or an Excel workbook (.xlsx, .xls, .xlsm).",
  too_large: "Split the document, or export just the statement pages and upload those.",
  encrypted_pdf: "Open the PDF, remove the password, save a copy and upload that.",
  no_text_layer: "Run OCR over the PDF first, or retype the statements into a spreadsheet.",
  empty_workbook: "Check that the workbook has data in at least one sheet.",
  missing_api_key: "Add ANTHROPIC_API_KEY to .env.local and restart the dev server.",
  refused: "The model declined this document. Check it is a financial filing and try a narrower page range.",
  truncated: "Pick a narrower page range for this document, or split the statement pages into their own upload and retry that section on its own.",
  storage_failed: "Check that the data directory is writable and has free disk space, then try again.",
  db_error: "Try again. If it keeps happening, check the terminal running the app for the full database error.",
};

export async function ingestAndExtract(
  deps: Deps,
  filename: string,
  bytes: Buffer,
): Promise<ActionResult<{ workspaceId: string }>> {
  let doc: IngestedDocument;
  try {
    doc = await ingest(filename, bytes);
  } catch (error) {
    const code = error instanceof IngestError ? error.code : "unreadable";
    return { ok: false, code, message: (error as Error).message, remediation: REMEDIATION[code] ?? GENERIC_REMEDIATION };
  }

  const documentId = deps.newId();
  const storagePath = path.join(deps.dataDir, "uploads", `${documentId}${path.extname(filename)}`);

  try {
    await deps.writeFile(storagePath, bytes);
  } catch (error) {
    return {
      ok: false, code: "storage_failed", message: (error as Error).message,
      remediation: REMEDIATION.storage_failed,
    };
  }

  const runId = deps.newId();
  try {
    deps.db.insert(schema.documents).values({
      id: documentId,
      filename,
      kind: doc.kind,
      hash: crypto.createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.length,
      storagePath,
      ingestedAt: deps.now(),
    }).run();

    deps.db.insert(schema.extractionRuns).values({
      id: runId, documentId, modelId: MODEL_ID, promptVersion: PROMPT_VERSION,
      status: "pending", createdAt: deps.now(),
    }).run();
  } catch (error) {
    return {
      ok: false, code: "db_error", message: (error as Error).message,
      remediation: REMEDIATION.db_error,
    };
  }

  try {
    const output = await extractDocument(doc, deps.call);

    for (const fact of output.facts) {
      deps.db.insert(schema.facts).values({
        id: deps.newId(),
        runId,
        canonicalKey: fact.canonicalKey,
        periodKey: fact.periodKey,
        value: fact.value,
        confidence: fact.confidence,
        provenance: fact.provenance,
      }).run();
    }

    const conflicts: schema.MergeConflictRecord[] = output.conflicts.map((conflict) => ({
      canonicalKey: conflict.canonicalKey,
      periodKey: conflict.periodKey,
      candidates: conflict.candidates.map((c) => ({
        value: c.value,
        confidence: c.confidence,
        provenance: c.provenance,
      })),
    }));

    deps.db.update(schema.extractionRuns)
      .set({ status: "complete", tokensIn: output.usage.tokensIn, tokensOut: output.usage.tokensOut, conflicts })
      .where(eq(schema.extractionRuns.id, runId)).run();

    const workspaceId = deps.newId();
    deps.db.insert(schema.workspaces).values({
      id: workspaceId, name: filename, activeRunId: runId, createdAt: deps.now(),
    }).run();

    return { ok: true, data: { workspaceId } };
  } catch (error) {
    const message = (error as Error).message;
    const code = error instanceof ExtractionFailedError && error.code ? error.code : "extraction_failed";
    // Recording the failure is best-effort: if the database is unavailable, this update will
    // throw for the same reason the primary operation did. Swallow it — reporting the original
    // failure to the caller is not optional, and a doomed status write must not pre-empt that.
    try {
      deps.db.update(schema.extractionRuns)
        .set({ status: "failed", error: message })
        .where(eq(schema.extractionRuns.id, runId)).run();
    } catch {
      // best-effort only; the ActionResult below is what the caller sees.
    }
    return { ok: false, code, message, remediation: REMEDIATION[code] ?? GENERIC_REMEDIATION };
  }
}

function periodRank(key: string): number {
  const fy = /^FY(\d{4})$/.exec(key);
  if (fy) return Number(fy[1]) * 10 + 9;
  const q = /^Q([1-4])-(\d{4})$/.exec(key);
  if (q) return Number(q[2]) * 10 + Number(q[1]);
  return -1;
}

/** A figure the extractor could not place, carried to the UI so the user can move it. */
export interface UnmappedFactRow {
  id: string;
  label: string;
  periodKey: string;
  value: number;
  page: number | null;
  rawValue: string;
}

export async function loadWorkspace(
  deps: Deps,
  workspaceId: string,
): Promise<WorkspaceView & { documentName: string; runId: string | null; unmapped: UnmappedFactRow[] }> {
  const [workspace] = deps.db.select().from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId)).all();
  if (!workspace) throw new Error(`No workspace ${workspaceId}`);

  const activeRun = workspace.activeRunId
    ? deps.db.select().from(schema.extractionRuns).where(eq(schema.extractionRuns.id, workspace.activeRunId)).all()[0]
    : undefined;

  const factRows = workspace.activeRunId
    ? deps.db.select().from(schema.facts).where(eq(schema.facts.runId, workspace.activeRunId)).all()
    : [];
  const overrideRows = deps.db.select().from(schema.overrides)
    .where(eq(schema.overrides.workspaceId, workspaceId)).all();

  // Unmapped figures are kept on the run so they can be remapped, but they belong
  // to no line item, so they must never reach a total or a reconciliation check.
  const mapped = factRows.filter((f) => f.canonicalKey !== UNMAPPED_KEY);
  const unmapped: UnmappedFactRow[] = factRows
    .filter((f) => f.canonicalKey === UNMAPPED_KEY)
    .map((f) => ({
      id: f.id,
      label: f.provenance.rawLabel,
      periodKey: f.periodKey,
      value: f.value,
      page: f.provenance.page,
      rawValue: f.provenance.rawValue,
    }));

  const periods = [...new Set([
    ...factRows.map((f) => f.periodKey),
    ...overrideRows.map((o) => o.periodKey),
  ])].sort((a, b) => periodRank(b) - periodRank(a));

  // A conflict on a cell the user has since overridden is resolved — the override is the user
  // picking a value, which is exactly what the finding's remediation asks them to do. Mirrors
  // buildWorkspace's own treatment of low_confidence: a value the user typed is not in question.
  const overriddenCells = new Set(overrideRows.map((o) => `${o.canonicalKey}::${o.periodKey}`));

  const view = buildWorkspace({
    periods,
    facts: mapped.map((f) => ({
      canonicalKey: f.canonicalKey, periodKey: f.periodKey, value: f.value,
      confidence: f.confidence, provenance: f.provenance,
    })),
    overrides: overrideRows.map((o) => ({
      canonicalKey: o.canonicalKey, periodKey: o.periodKey, value: o.value,
    })),
    scaleFactors: mapped.map((f) => f.provenance.scaleFactor),
    conflicts: (activeRun?.conflicts ?? [])
      .filter((c) => !overriddenCells.has(`${c.canonicalKey}::${c.periodKey}`))
      .map((c) => ({ canonicalKey: c.canonicalKey, periodKey: c.periodKey })),
  });

  return { ...view, documentName: workspace.name, runId: workspace.activeRunId, unmapped };
}

export async function setOverride(
  deps: Deps,
  workspaceId: string,
  canonicalKey: string,
  periodKey: string,
  value: number | null,
): Promise<void> {
  const where = and(
    eq(schema.overrides.workspaceId, workspaceId),
    eq(schema.overrides.canonicalKey, canonicalKey),
    eq(schema.overrides.periodKey, periodKey),
  );

  if (value === null) {
    deps.db.delete(schema.overrides).where(where).run();
    return;
  }
  const existing = deps.db.select().from(schema.overrides).where(where).all();
  if (existing.length > 0) {
    deps.db.update(schema.overrides).set({ value, updatedAt: deps.now() }).where(where).run();
    return;
  }
  deps.db.insert(schema.overrides).values({
    id: deps.newId(), workspaceId, canonicalKey, periodKey, value, updatedAt: deps.now(),
  }).run();
}
