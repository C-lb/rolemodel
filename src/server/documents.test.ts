import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { migrate } from "@/db/client";
import { ingestAndExtract, loadWorkspace, setOverride, type Deps } from "./documents";

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
    figures: [{
      canonical_key: "total_assets", raw_label: "Total assets", raw_value: "1,000", value: 1000,
      scale_factor: 1, scale_evidence: "", sign_flipped: false, period_key: "FY2024",
      page: null, sheet: "BS", locator: "row 1", confidence: 0.9,
    }],
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
    expect(d.db.select().from(schema.facts).all()).toHaveLength(1);
    expect(d.db.select().from(schema.workspaces).all()).toHaveLength(1);
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
