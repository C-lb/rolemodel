import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { migrate } from "@/db/client";
import { MissingApiKeyError } from "@/extract/client";
import { INGEST_ERROR_CODES } from "@/ingest";
import { ingestAndExtract, loadWorkspace, setOverride, REMEDIATION, type Deps } from "./documents";
import { remapFact } from "./remap";

function deps(call: Deps["call"]) {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db);
  const written: Record<string, Buffer> = {};
  return {
    db,
    call,
    now: () => 1,
    newId: (() => { let n = 0; return () => `id${++n}`; })(),
    writeFile: async (p: string, b: Buffer) => { written[p] = b; },
    dataDir: "/tmp/finmodel-test",
    written,
  };
}

const xlsxName = "model.xlsx";

// A one-sheet workbook built inline so the test needs no fixture file.
async function tinyWorkbook(): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BS");
  ws.addRow(["Total assets", 1000]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const goodResult = {
  result: {
    periods: ["FY2024"], currency: "USD", unmapped_labels: [], notes: "",
    figures: [
      {
        canonical_key: "total_assets", raw_label: "Total assets", raw_value: "1,000", value: 1000,
        scale_factor: 1, scale_evidence: "", sign_flipped: false, period_key: "FY2024",
        page: null, sheet: "BS", locator: "row 1", confidence: 0.9,
      },
      {
        canonical_key: "unmapped", raw_label: "Restructuring reserve", raw_value: "50", value: 50,
        scale_factor: 1, scale_evidence: "", sign_flipped: false, period_key: "FY2024",
        page: 4, sheet: "BS", locator: "row 2", confidence: 0.4,
      },
    ],
  },
  tokensIn: 10, tokensOut: 4,
};

const conflictResult = {
  result: {
    periods: ["FY2024"], currency: "USD", unmapped_labels: [], notes: "",
    figures: [
      {
        canonical_key: "total_assets", raw_label: "Total assets", raw_value: "1,000", value: 1000,
        scale_factor: 1, scale_evidence: "", sign_flipped: false, period_key: "FY2024",
        page: null, sheet: "BS", locator: "row 1", confidence: 0.9,
      },
      {
        canonical_key: "total_assets", raw_label: "Total assets (restated)", raw_value: "1,200", value: 1200,
        scale_factor: 1, scale_evidence: "", sign_flipped: false, period_key: "FY2024",
        page: null, sheet: "BS", locator: "row 2", confidence: 0.5,
      },
    ],
  },
  tokensIn: 10, tokensOut: 4,
};

describe("ingestAndExtract", () => {
  let bytes: Buffer;
  beforeEach(async () => { bytes = await tinyWorkbook(); });

  it("persists document, run, facts and a workspace on success", async () => {
    const d = deps(vi.fn().mockResolvedValue(goodResult));
    const out = await ingestAndExtract(d, xlsxName, bytes);
    expect(out.ok).toBe(true);
    expect(d.db.select().from(schema.documents).all()).toHaveLength(1);
    expect(d.db.select().from(schema.workspaces).all()).toHaveLength(1);

    // Both the mapped figure and the one the extractor could not place are kept:
    // an unmapped figure the user can still move is worth more than a dropped one.
    const keys = d.db.select().from(schema.facts).all().map((f) => f.canonicalKey).sort();
    expect(keys).toEqual(["total_assets", "unmapped"]);
  });

  it("returns a coded failure for an unsupported file instead of throwing", async () => {
    const d = deps(vi.fn());
    const out = await ingestAndExtract(d, "notes.txt", Buffer.from("hi"));
    expect(out).toMatchObject({ ok: false, code: "unsupported_type" });
    if (!out.ok) expect(out.remediation.length).toBeGreaterThan(0);
  });

  it("records a failed run and returns a failure when extraction throws", async () => {
    const d = deps(vi.fn().mockRejectedValue(new Error("overloaded")));
    const out = await ingestAndExtract(d, xlsxName, bytes);
    expect(out.ok).toBe(false);
    const runs = d.db.select().from(schema.extractionRuns).all();
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error).toContain("overloaded");
  });

  it("writes the uploaded bytes to disk under the data directory", async () => {
    const d = deps(vi.fn().mockResolvedValue(goodResult));
    await ingestAndExtract(d, xlsxName, bytes);
    const paths = Object.keys(d.written);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain("/tmp/finmodel-test");
  });

  it("persists extraction conflicts and surfaces a merge_conflict finding via loadWorkspace", async () => {
    const d = deps(vi.fn().mockResolvedValue(conflictResult));
    const out = await ingestAndExtract(d, xlsxName, bytes);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("setup failed");

    const runs = d.db.select().from(schema.extractionRuns).all();
    expect(runs[0].conflicts).toHaveLength(1);
    expect(runs[0].conflicts[0]).toMatchObject({ canonicalKey: "total_assets", periodKey: "FY2024" });
    expect(runs[0].conflicts[0].candidates).toHaveLength(2);

    const ws = await loadWorkspace(d, out.data.workspaceId);
    expect(ws.findings.some((f) => f.code === "merge_conflict")).toBe(true);
  });

  it("clears the merge_conflict finding once the user overrides the conflicting cell", async () => {
    const d = deps(vi.fn().mockResolvedValue(conflictResult));
    const out = await ingestAndExtract(d, xlsxName, bytes);
    if (!out.ok) throw new Error("setup failed");

    await setOverride(d, out.data.workspaceId, "total_assets", "FY2024", 1500);
    const ws = await loadWorkspace(d, out.data.workspaceId);
    expect(ws.findings.some((f) => f.code === "merge_conflict")).toBe(false);
    expect(ws.cell("total_assets", "FY2024").value).toBe(1500);
  });

  it("propagates a MissingApiKeyError's code and its specific remediation", async () => {
    const d = deps(vi.fn().mockRejectedValue(new MissingApiKeyError()));
    const out = await ingestAndExtract(d, xlsxName, bytes);
    expect(out).toMatchObject({ ok: false, code: "missing_api_key" });
    if (out.ok) throw new Error("expected failure");
    expect(out.remediation).toBe("Add ANTHROPIC_API_KEY to .env.local and restart the dev server.");
  });

  it("still returns a coded failure when recording the failed run also throws", async () => {
    const d = deps(vi.fn().mockRejectedValue(new Error("overloaded")));
    vi.spyOn(d.db, "update").mockImplementation(() => {
      throw new Error("database is unavailable");
    });
    const out = await ingestAndExtract(d, xlsxName, bytes);
    expect(out).toMatchObject({ ok: false, code: "extraction_failed" });
    if (!out.ok) expect(out.message).toContain("overloaded");
  });
});

describe("loadWorkspace unmapped figures", () => {
  it("returns unmapped facts separately and keeps them out of the statements", async () => {
    const d = deps(vi.fn().mockResolvedValue(goodResult));
    const created = await ingestAndExtract(d, xlsxName, await tinyWorkbook());
    if (!created.ok) throw new Error("setup failed");

    const ws = await loadWorkspace(d, created.data.workspaceId);
    expect(ws.unmapped).toHaveLength(1);
    expect(ws.unmapped[0]).toMatchObject({
      label: "Restructuring reserve", periodKey: "FY2024", value: 50, page: 4, rawValue: "50",
    });

    // Nothing downstream sees it: no cell holds it, and it cannot drag a total or
    // a reconciliation check off with it.
    expect(ws.cell("unmapped", "FY2024").value).toBeUndefined();
    expect(ws.findings.some((f) => f.code === "low_confidence")).toBe(false);
  });

  it("moves a remapped fact into the statements and out of the unmapped list", async () => {
    const d = deps(vi.fn().mockResolvedValue(goodResult));
    const created = await ingestAndExtract(d, xlsxName, await tinyWorkbook());
    if (!created.ok) throw new Error("setup failed");

    const before = await loadWorkspace(d, created.data.workspaceId);
    await remapFact(d, created.data.workspaceId, before.unmapped[0].id, "inventory");

    const after = await loadWorkspace(d, created.data.workspaceId);
    expect(after.unmapped).toHaveLength(0);
    expect(after.cell("inventory", "FY2024").value).toBe(50);
  });
});

describe("remapping against a workspace", () => {
  it("refuses a line the user has already typed a value into, rather than hiding the figure behind it", async () => {
    const d = deps(vi.fn().mockResolvedValue(goodResult));
    const created = await ingestAndExtract(d, xlsxName, await tinyWorkbook());
    if (!created.ok) throw new Error("setup failed");
    const wsId = created.data.workspaceId;

    // The user fills in a line the extractor left blank, then tries to move a
    // stray figure onto it. An override wins over a fact in the view, so a move
    // that succeeded here would put the figure somewhere nobody can see it.
    await setOverride(d, wsId, "goodwill", "FY2024", 400);
    const before = await loadWorkspace(d, wsId);

    await expect(remapFact(d, wsId, before.unmapped[0].id, "goodwill"))
      .rejects.toThrow(/already has a value you entered for FY2024/);

    const after = await loadWorkspace(d, wsId);
    expect(after.unmapped).toHaveLength(1);
    expect(after.cell("goodwill", "FY2024").value).toBe(400);
  });
});

describe("overrides", () => {
  it("applies, replaces and clears an override", async () => {
    const d = deps(vi.fn().mockResolvedValue(goodResult));
    const created = await ingestAndExtract(d, xlsxName, await tinyWorkbook());
    if (!created.ok) throw new Error("setup failed");
    const wsId = created.data.workspaceId;

    await setOverride(d, wsId, "total_assets", "FY2024", 2000);
    expect((await loadWorkspace(d, wsId)).cell("total_assets", "FY2024").value).toBe(2000);

    await setOverride(d, wsId, "total_assets", "FY2024", 3000);
    expect(d.db.select().from(schema.overrides).all()).toHaveLength(1);

    await setOverride(d, wsId, "total_assets", "FY2024", null);
    const ws = await loadWorkspace(d, wsId);
    expect(ws.cell("total_assets", "FY2024").value).toBe(1000);
    expect(ws.cell("total_assets", "FY2024").source).toBe("extracted");
  });
});

describe("remediation copy", () => {
  it("has an entry for every ingest error code", () => {
    // `unreadable` is also the fallback for any non-IngestError, so a gap here
    // means the most likely ingest failure gets advice that cannot work.
    const missing = INGEST_ERROR_CODES.filter((code) => !REMEDIATION[code]);
    expect(missing).toEqual([]);
  });

  it("has an entry for every code ingestAndExtract can return", () => {
    // Codes raised past ingest: the extract client's own, plus this module's.
    const others = ["missing_api_key", "refused", "truncated", "extraction_failed", "storage_failed", "db_error"];
    expect(others.filter((code) => !REMEDIATION[code])).toEqual([]);
  });

  it("has no empty entries", () => {
    const empty = Object.entries(REMEDIATION).filter(([, v]) => v.trim().length === 0).map(([k]) => k);
    expect(empty).toEqual([]);
  });
});
