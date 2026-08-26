import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { migrate, type Db } from "@/db/client";
import type { Deps } from "./documents";
import {
  listCustomRatios,
  saveCustomRatio,
  deleteCustomRatio,
  setAveragingMode,
  readAveragingMode,
} from "./ratios";

function freshDb(): Db {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db);
  return db;
}

let counter = 0;

function depsFor(db: Db): Deps {
  return {
    db,
    call: async () => {
      throw new Error("the ratio store must never call the model");
    },
    now: () => 1_700_000_000_000,
    newId: () => `id${(counter += 1)}`,
    writeFile: async () => {
      throw new Error("the ratio store must never touch the filesystem");
    },
    dataDir: "/nowhere",
  };
}

function makeWorkspace(db: Db, id: string): void {
  db.insert(schema.workspaces).values({ id, name: id, createdAt: 1 }).run();
}

describe("custom ratios", () => {
  let db: Db;
  let deps: Deps;

  beforeEach(() => {
    db = freshDb();
    deps = depsFor(db);
    makeWorkspace(db, "ws1");
    makeWorkspace(db, "ws2");
  });

  it("round-trips a saved ratio", async () => {
    const saved = await saveCustomRatio(deps, {
      workspaceId: "ws1",
      label: "R&D intensity",
      expression: "research_development / revenue",
      note: "How much of each sale goes back into the product",
    });
    expect(saved.ok).toBe(true);

    const rows = await listCustomRatios(deps, "ws1");
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("R&D intensity");
    expect(rows[0].expression).toBe("research_development / revenue");
    expect(rows[0].note).toBe("How much of each sale goes back into the product");
  });

  it("derives a key from the label", async () => {
    const saved = await saveCustomRatio(deps, {
      workspaceId: "ws1",
      label: "R&D intensity",
      expression: "research_development / revenue",
      note: null,
    });
    expect(saved.ok && saved.data.key).toBe("rd_intensity");
  });

  it("disambiguates a key that is already taken in this workspace", async () => {
    const first = await saveCustomRatio(deps, {
      workspaceId: "ws1", label: "Coverage", expression: "revenue / interest_expense", note: null,
    });
    const second = await saveCustomRatio(deps, {
      workspaceId: "ws1", label: "Coverage", expression: "gross_profit / interest_expense", note: null,
    });
    expect(first.ok && first.data.key).toBe("coverage");
    expect(second.ok && second.data.key).toBe("coverage_2");
  });

  it("never collides with a built-in ratio key", async () => {
    const saved = await saveCustomRatio(deps, {
      workspaceId: "ws1", label: "Current ratio", expression: "total_current_assets / total_assets", note: null,
    });
    expect(saved.ok && saved.data.key).toBe("current_ratio_2");
  });

  it("keeps workspaces separate", async () => {
    await saveCustomRatio(deps, {
      workspaceId: "ws1", label: "Coverage", expression: "revenue / interest_expense", note: null,
    });
    const other = await saveCustomRatio(deps, {
      workspaceId: "ws2", label: "Coverage", expression: "revenue / interest_expense", note: null,
    });
    expect(other.ok && other.data.key).toBe("coverage");
    expect(await listCustomRatios(deps, "ws2")).toHaveLength(1);
  });

  it("returns a parse failure with its offset rather than throwing", async () => {
    const saved = await saveCustomRatio(deps, {
      workspaceId: "ws1", label: "Broken", expression: "revenue / ", note: null,
    });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.code).toBe("invalid_expression");
    expect(saved.message).toMatch(/expected/i);
    expect(saved.remediation).toMatch(/10|character/i);
  });

  it("rejects an identifier that is neither a line item nor a ratio", async () => {
    const saved = await saveCustomRatio(deps, {
      workspaceId: "ws1", label: "Nonsense", expression: "revenue / profit_margin_thing", note: null,
    });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.code).toBe("unknown_identifier");
    expect(saved.message).toContain("profit_margin_thing");
  });

  it("accepts a reference to a built-in ratio", async () => {
    const saved = await saveCustomRatio(deps, {
      workspaceId: "ws1", label: "Margin gap", expression: "gross_margin - net_margin", note: null,
    });
    expect(saved.ok).toBe(true);
  });

  it("rejects a self-reference", async () => {
    const first = await saveCustomRatio(deps, {
      workspaceId: "ws1", label: "Loop", expression: "revenue / total_assets", note: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const updated = await saveCustomRatio(deps, {
      workspaceId: "ws1", key: first.data.key, label: "Loop", expression: `${first.data.key} + 1`, note: null,
    });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.code).toBe("cycle");
  });

  it("rejects a cycle through another custom ratio", async () => {
    const a = await saveCustomRatio(deps, {
      workspaceId: "ws1", label: "Alpha", expression: "revenue / total_assets", note: null,
    });
    const b = await saveCustomRatio(deps, {
      workspaceId: "ws1", label: "Beta", expression: "alpha + 1", note: null,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok) return;

    const updated = await saveCustomRatio(deps, {
      workspaceId: "ws1", key: a.data.key, label: "Alpha", expression: "beta + 1", note: null,
    });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.code).toBe("cycle");
    expect(updated.message).toMatch(/beta|alpha/i);
  });

  it("updates a ratio in place when given its key", async () => {
    const saved = await saveCustomRatio(deps, {
      workspaceId: "ws1", label: "Alpha", expression: "revenue / total_assets", note: null,
    });
    if (!saved.ok) throw new Error("expected the save to succeed");

    await saveCustomRatio(deps, {
      workspaceId: "ws1", key: saved.data.key, label: "Alpha", expression: "revenue / total_equity", note: "changed",
    });

    const rows = await listCustomRatios(deps, "ws1");
    expect(rows).toHaveLength(1);
    expect(rows[0].expression).toBe("revenue / total_equity");
    expect(rows[0].note).toBe("changed");
  });

  it("deletes a ratio and the interpretations cached for it", async () => {
    const saved = await saveCustomRatio(deps, {
      workspaceId: "ws1", label: "Alpha", expression: "revenue / total_assets", note: null,
    });
    if (!saved.ok) throw new Error("expected the save to succeed");

    db.insert(schema.interpretations).values({
      id: "i1", workspaceId: "ws1", ratioKey: saved.data.key, inputHash: "h",
      text: "cached", declined: 0, reason: null, modelId: "claude-opus-5",
      promptVersion: 1, tokensIn: 10, tokensOut: 20, createdAt: 1,
    }).run();

    const deleted = await deleteCustomRatio(deps, "ws1", saved.data.key);
    expect(deleted.ok).toBe(true);
    expect(await listCustomRatios(deps, "ws1")).toHaveLength(0);
    expect(
      db.select().from(schema.interpretations).where(eq(schema.interpretations.ratioKey, saved.data.key)).all(),
    ).toHaveLength(0);
  });

  it("reports a delete of something that is not there", async () => {
    const deleted = await deleteCustomRatio(deps, "ws1", "never_existed");
    expect(deleted.ok).toBe(false);
    if (deleted.ok) return;
    expect(deleted.code).toBe("not_found");
  });
});

describe("averaging mode", () => {
  let db: Db;
  let deps: Deps;

  beforeEach(() => {
    db = freshDb();
    deps = depsFor(db);
    makeWorkspace(db, "ws1");
  });

  it("defaults to averaging balances", async () => {
    expect(await readAveragingMode(deps, "ws1")).toBe("average");
  });

  it("round-trips a change", async () => {
    const result = await setAveragingMode(deps, "ws1", "ending");
    expect(result.ok).toBe(true);
    expect(await readAveragingMode(deps, "ws1")).toBe("ending");
  });

  it("rejects a mode that is not one of the two", async () => {
    const result = await setAveragingMode(deps, "ws1", "median" as "average");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_mode");
    expect(await readAveragingMode(deps, "ws1")).toBe("average");
  });
});

describe("migrating a database created before M2", () => {
  it("adds the averaging column to an existing workspaces table", () => {
    const sqlite = new Database(":memory:");
    // The M1 shape: no averaging_mode column.
    sqlite.exec(
      `CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL,
         active_run_id TEXT, created_at INTEGER NOT NULL)`,
    );
    sqlite.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES ('old', 'old', 1)`).run();

    const db = drizzle(sqlite, { schema });
    migrate(db);

    const columns = sqlite.prepare(`PRAGMA table_info(workspaces)`).all() as { name: string }[];
    expect(columns.map((c) => c.name)).toContain("averaging_mode");

    const row = sqlite.prepare(`SELECT averaging_mode FROM workspaces WHERE id = 'old'`).get() as {
      averaging_mode: string;
    };
    expect(row.averaging_mode).toBe("average");
  });

  it("is safe to run twice", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite, { schema });
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
  });
});
