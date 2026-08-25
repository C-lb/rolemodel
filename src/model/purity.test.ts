import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MODEL_DIR = path.join(process.cwd(), "src/model");

// Module specifiers this layer may never reference — whether pulled in via a
// static `from` import or a dynamic `import()` / `require()` call. Anchored so
// "react-icons" or "next-themes" don't false-positive on the "react"/"next" alt.
const MODULE_PATTERN =
  '(?:@/(?:app|ingest|extract)(?:/[^"\'`]*)?' +
  '|next(?:/[^"\'`]*)?' +
  '|react-dom(?:/[^"\'`]*)?' +
  '|react/jsx-runtime' +
  '|react)';

const FORBIDDEN: { pattern: RegExp; label: string }[] = [
  { pattern: new RegExp(`from\\s+["']${MODULE_PATTERN}["']`), label: "static `from` import of a forbidden layer" },
  {
    pattern: new RegExp(`(?:import|require)\\s*\\(\\s*["']${MODULE_PATTERN}["']`),
    label: "dynamic import()/require() of a forbidden layer",
  },
];

function listModelFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listModelFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

// Collapse all whitespace (including newlines) to a single space so a
// multi-line import statement can be matched as one line.
function normalizeWhitespace(source: string): string {
  return source.replace(/\s+/g, " ");
}

describe("model layer purity", () => {
  const files = listModelFiles(MODEL_DIR);

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const relative = path.relative(MODEL_DIR, file);

    it(`${relative} imports no other layer`, () => {
      const source = fs.readFileSync(file, "utf8");
      for (const { pattern, label } of FORBIDDEN) {
        expect(pattern.test(source), `${relative} matches ${pattern} (${label})`).toBe(false);
      }
    });

    it(`${relative} imports from @/db only as a type`, () => {
      const normalized = normalizeWhitespace(fs.readFileSync(file, "utf8"));
      // Whitespace is normalized above, so this matches a multi-line import
      // statement as readily as a single-line one.
      const dbImports = normalized.match(/import[^;]*?from\s+"@\/db[^"]*";/g) ?? [];
      for (const statement of dbImports) {
        expect(/^import\s+type\s+/.test(statement), `${relative}: ${statement}`).toBe(true);
      }
    });
  }
});
