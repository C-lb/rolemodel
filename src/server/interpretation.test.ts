import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { migrate, type Db } from "@/db/client";
import { computeRatios, type RatioResult } from "@/model/ratios/compute";
import { fixtureWorkspace } from "@/model/ratios/fixtures";
import { MissingApiKeyError } from "@/extract/client";
import { InterpretationRefusedError, type CallResult } from "@/extract/interpret";
import type { Deps } from "./documents";
import { explainRatio, type InterpretDeps } from "./interpretation";

function freshDb(): Db {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db);
  db.insert(schema.workspaces).values({ id: "ws1", name: "ws1", createdAt: 1 }).run();
  return db;
}

let counter = 0;

function baseDeps(db: Db): Deps {
  return {
    db,
    call: async () => {
      throw new Error("the extraction seam is not used here");
    },
    now: () => 1_700_000_000_000,
    newId: () => `id${(counter += 1)}`,
    writeFile: async () => {
      throw new Error("no filesystem");
    },
    dataDir: "/nowhere",
  };
}

const reading: CallResult = {
  text: "Net margin held at 14.0% as revenue and net income rose together.",
  declined: false,
  reason: null,
  tokensIn: 500,
  tokensOut: 60,
};

function ratiosFor(options = {}): RatioResult[] {
  return computeRatios({ workspace: fixtureWorkspace(options), mode: "ending", custom: [] });
}

function resultFor(key: string, options = {}): RatioResult {
  const found = ratiosFor(options).find((r) => r.key === key);
  if (!found) throw new Error(`no ratio "${key}"`);
  return found;
}

describe("explaining a ratio", () => {
  let db: Db;
  let calls: number;
  let deps: InterpretDeps;

  beforeEach(() => {
    db = freshDb();
    calls = 0;
    deps = {
      ...baseDeps(db),
      interpret: async () => {
        calls += 1;
        return reading;
      },
    };
  });

  it("generates a reading and returns it", async () => {
    const result = await explainRatio(deps, "ws1", resultFor("net_margin"), "ending");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.text).toContain("Net margin");
    expect(result.data.cached).toBe(false);
    expect(calls).toBe(1);
  });

  it("serves the second identical request from the cache", async () => {
    await explainRatio(deps, "ws1", resultFor("net_margin"), "ending");
    const second = await explainRatio(deps, "ws1", resultFor("net_margin"), "ending");
    expect(second.ok && second.data.cached).toBe(true);
    expect(calls).toBe(1);
  });

  it("records what the generation cost", async () => {
    await explainRatio(deps, "ws1", resultFor("net_margin"), "ending");
    const rows = db.select().from(schema.interpretations).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokensIn).toBe(500);
    expect(rows[0].tokensOut).toBe(60);
    expect(rows[0].modelId).toBe("claude-opus-5");
  });

  it("regenerates when a figure behind the ratio changes", async () => {
    await explainRatio(deps, "ws1", resultFor("net_margin"), "ending");
    const edited = resultFor("net_margin", {
      overrides: [{ canonicalKey: "revenue", periodKey: "FY2024", value: 16000 }],
    });
    const second = await explainRatio(deps, "ws1", edited, "ending");
    expect(second.ok && second.data.cached).toBe(false);
    expect(calls).toBe(2);
  });

  it("regenerates when the balance convention changes", async () => {
    await explainRatio(deps, "ws1", resultFor("roa"), "ending");
    const averaged = computeRatios({ workspace: fixtureWorkspace(), mode: "average", custom: [] }).find(
      (r) => r.key === "roa",
    );
    if (!averaged) throw new Error("no roa");
    const second = await explainRatio(deps, "ws1", averaged, "average");
    expect(second.ok && second.data.cached).toBe(false);
    expect(calls).toBe(2);
  });

  it("keeps one workspace's readings out of another's", async () => {
    db.insert(schema.workspaces).values({ id: "ws2", name: "ws2", createdAt: 1 }).run();
    await explainRatio(deps, "ws1", resultFor("net_margin"), "ending");
    const other = await explainRatio(deps, "ws2", resultFor("net_margin"), "ending");
    expect(other.ok && other.data.cached).toBe(false);
    expect(calls).toBe(2);
  });

  it("caches a declined reading so the same decline is not paid for twice", async () => {
    deps = {
      ...baseDeps(db),
      interpret: async () => {
        calls += 1;
        return { text: "", declined: true, reason: "Only one period has a value.", tokensIn: 1, tokensOut: 1 };
      },
    };
    const first = await explainRatio(deps, "ws1", resultFor("net_margin"), "ending");
    const second = await explainRatio(deps, "ws1", resultFor("net_margin"), "ending");
    expect(first.ok && first.data.declined).toBe(true);
    expect(second.ok && second.data.reason).toBe("Only one period has a value.");
    expect(calls).toBe(1);
  });

  it("refuses to read a ratio that has no value in any period", async () => {
    const empty = computeRatios({
      workspace: fixtureWorkspace({ rows: { FY2024: { revenue: 15000 } } }),
      mode: "ending",
      custom: [],
    }).find((r) => r.key === "roe");
    if (!empty) throw new Error("no roe");

    const result = await explainRatio(deps, "ws1", empty, "ending");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("nothing_to_explain");
    expect(calls).toBe(0);
  });

  it("reports a missing API key without touching the cache", async () => {
    deps = {
      ...baseDeps(db),
      interpret: async () => {
        throw new MissingApiKeyError();
      },
    };
    const result = await explainRatio(deps, "ws1", resultFor("net_margin"), "ending");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("missing_api_key");
    expect(result.remediation).toMatch(/ANTHROPIC_API_KEY/);
    expect(db.select().from(schema.interpretations).all()).toHaveLength(0);
  });

  it("reports a refusal as its own failure", async () => {
    deps = {
      ...baseDeps(db),
      interpret: async () => {
        throw new InterpretationRefusedError("cyber");
      },
    };
    const result = await explainRatio(deps, "ws1", resultFor("net_margin"), "ending");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("refused");
  });

  it("reports an API failure without losing the numbers", async () => {
    deps = {
      ...baseDeps(db),
      interpret: async () => {
        throw new Error("503 upstream");
      },
    };
    const result = await explainRatio(deps, "ws1", resultFor("net_margin"), "ending");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("interpretation_failed");
    expect(result.message).toContain("503");
  });
});
