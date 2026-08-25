import path from "node:path";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { ingest, IngestError } from "@/ingest";
import { extractDocument, ExtractionFailedError, type ClaudeCaller } from "@/extract/extract";
import { PROMPT_VERSION } from "@/extract/prompt";
import { MODEL_ID } from "@/extract/client";
import { buildWorkspace, type WorkspaceView } from "@/model/workspace";

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
};

export async function ingestAndExtract(
  deps: Deps,
  filename: string,
  bytes: Buffer,
): Promise<ActionResult<{ workspaceId: string }>> {
  let doc;
  try {
    doc = await ingest(filename, bytes);
  } catch (error) {
    const code = error instanceof IngestError ? error.code : "unreadable";
    return { ok: false, code, message: (error as Error).message, remediation: REMEDIATION[code] ?? GENERIC_REMEDIATION };
  }

  const documentId = deps.newId();
  const storagePath = path.join(deps.dataDir, "uploads", `${documentId}${path.extname(filename)}`);
  await deps.writeFile(storagePath, bytes);

  deps.db.insert(schema.documents).values({
    id: documentId,
    filename,
    kind: doc.kind,
    hash: crypto.createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
    storagePath,
    ingestedAt: deps.now(),
  }).run();

  const runId = deps.newId();
  deps.db.insert(schema.extractionRuns).values({
    id: runId, documentId, modelId: MODEL_ID, promptVersion: PROMPT_VERSION,
    status: "pending", createdAt: deps.now(),
  }).run();

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
    deps.db.update(schema.extractionRuns)
      .set({ status: "failed", error: message })
      .where(eq(schema.extractionRuns.id, runId)).run();
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

export async function loadWorkspace(
  deps: Deps,
  workspaceId: string,
): Promise<WorkspaceView & { documentName: string; runId: string | null }> {
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

  const periods = [...new Set([
    ...factRows.map((f) => f.periodKey),
    ...overrideRows.map((o) => o.periodKey),
  ])].sort((a, b) => periodRank(b) - periodRank(a));

  const view = buildWorkspace({
    periods,
    facts: factRows.map((f) => ({
      canonicalKey: f.canonicalKey, periodKey: f.periodKey, value: f.value,
      confidence: f.confidence, provenance: f.provenance,
    })),
    overrides: overrideRows.map((o) => ({
      canonicalKey: o.canonicalKey, periodKey: o.periodKey, value: o.value,
    })),
    scaleFactors: factRows.map((f) => f.provenance.scaleFactor),
    conflicts: (activeRun?.conflicts ?? []).map((c) => ({
      canonicalKey: c.canonicalKey, periodKey: c.periodKey,
    })),
  });

  return { ...view, documentName: workspace.name, runId: workspace.activeRunId };
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
