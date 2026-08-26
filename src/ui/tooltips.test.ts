import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TOOLTIPS, CONTROL_KEYS, tooltip } from "./tooltips";
import { TAXONOMY } from "@/model/taxonomy";
import { FINDING_CODES } from "@/model/validate";

const SRC_DIR = path.join(process.cwd(), "src");

/** Every source file that could hold a tooltip call site, tests and the registry aside. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name) || entry.name === "tooltips.ts") continue;
    out.push(full);
  }
  return out;
}

describe("tooltip registry", () => {
  it("has an entry for every canonical line item", () => {
    const missing = TAXONOMY.filter((i) => !TOOLTIPS[`item.${i.key}`]).map((i) => i.key);
    expect(missing).toEqual([]);
  });

  it("has an entry for every finding code", () => {
    const missing = FINDING_CODES.filter((c) => !TOOLTIPS[`finding.${c}`]);
    expect(missing).toEqual([]);
  });

  it("has an entry for every control", () => {
    const missing = CONTROL_KEYS.filter((c) => !TOOLTIPS[c]);
    expect(missing).toEqual([]);
  });

  it("has no control key without a call site", () => {
    // Asserting only that every key has copy lets the registry accumulate copy for
    // controls that were never built, which nobody can check against the product.
    const used = new Set<string>();
    for (const file of sourceFiles(SRC_DIR)) {
      for (const match of fs.readFileSync(file, "utf8").matchAll(/tooltip\(\s*"([^"]+)"\s*\)/g)) {
        used.add(match[1]);
      }
    }
    const unused = CONTROL_KEYS.filter((key) => !used.has(key));
    expect(unused).toEqual([]);
  });

  it("has no empty entries", () => {
    const empty = Object.entries(TOOLTIPS).filter(([, v]) => v.trim().length === 0).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it("throws on an unknown key so gaps surface in development", () => {
    expect(() => tooltip("item.does_not_exist")).toThrow(/does_not_exist/);
  });
});
