import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MODEL_DIR = path.join(process.cwd(), "src/model");
// The model layer may reference the Provenance *type* from db/schema, but must not
// import runtime code from any other layer.
const FORBIDDEN = [/from\s+"@\/app/, /from\s+"@\/ingest/, /from\s+"@\/extract/, /from\s+"next\//, /from\s+"react"/];

describe("model layer purity", () => {
  const files = fs.readdirSync(MODEL_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} imports no other layer`, () => {
      const source = fs.readFileSync(path.join(MODEL_DIR, file), "utf8");
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(source), `${file} matches ${pattern}`).toBe(false);
      }
    });
  }

  it("imports from @/db only as a type", () => {
    for (const file of files) {
      const source = fs.readFileSync(path.join(MODEL_DIR, file), "utf8");
      const dbImports = source.match(/^import\s+(.+?)\s+from\s+"@\/db[^"]*";$/gm) ?? [];
      for (const line of dbImports) {
        expect(line.startsWith("import type"), `${file}: ${line}`).toBe(true);
      }
    }
  });
});
