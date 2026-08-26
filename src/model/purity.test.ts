import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import ts from "typescript";

const MODEL_DIR = path.join(process.cwd(), "src/model");

const NODE_BUILTINS = new Set(builtinModules);

// Layers the model must never reach into, at runtime, regardless of the
// syntax used to reach them (static import, `require`, dynamic `import()`,
// re-export, template-literal specifier, ...).
//
// `@/server` is the persistence seam and `@/ui` is the view layer: reaching
// either from the model puts I/O or React behind a function the spec says is
// pure. Node builtins are listed for the same reason — `node:fs` is the most
// direct way there is to break "no I/O", and it needs no other layer's help.
function isForbiddenModule(specifier: string): boolean {
  if (/^@\/(app|ingest|extract|server|ui)(\/|$)/.test(specifier)) return true;
  if (specifier === "next" || specifier.startsWith("next/")) return true;
  if (specifier === "react" || specifier === "react-dom" || specifier === "react/jsx-runtime") return true;
  if (specifier.startsWith("react-dom/")) return true;
  if (specifier.startsWith("node:")) return true;
  if (NODE_BUILTINS.has(specifier)) return true;
  return false;
}

function isDbModule(specifier: string): boolean {
  return specifier === "@/db" || specifier.startsWith("@/db/");
}

interface ModuleUsage {
  /** The static (leading, in the template-literal case) text of the specifier. */
  specifier: string;
  /** True when nothing in the declaration survives to runtime: `import type ...`, or every specifier marked `type`. */
  isTypeOnly: boolean;
  /** How this reference reaches the module — for failure messages. */
  kind: string;
  /** Source text of the enclosing statement — for failure messages. */
  statementText: string;
}

/**
 * True when nothing in this import survives to runtime.
 *
 * `import type { X } from` sets the flag on the clause, but the per-specifier form
 * `import { type X } from` sets it on each element instead — it is just as type-only,
 * and reading only the clause flag calls it a runtime import.
 */
function importIsTypeOnly(clause: ts.ImportClause | undefined): boolean {
  // A bare `import "x"` runs the module for its side effects.
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  // A default binding, or `import * as ns`, brings a value in.
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
}

/** The same rule for `export { type X } from "..."`. */
function exportIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return false;
  return clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly);
}

/** The literal (or, for a template literal with substitutions, the static leading) text of a specifier expression. */
function specifierText(expr: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(expr)) return expr.text;
  if (ts.isTemplateExpression(expr)) return expr.head.text;
  return undefined;
}

function isDynamicImportCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function isRequireCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require";
}

/** Walk the AST and collect every place this file references an external module by specifier. */
function collectModuleUsages(sourceFile: ts.SourceFile): ModuleUsage[] {
  const usages: ModuleUsage[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      usages.push({
        specifier: node.moduleSpecifier.text,
        isTypeOnly: importIsTypeOnly(node.importClause),
        kind: "static import",
        statementText: node.getText(sourceFile),
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      usages.push({
        specifier: node.moduleSpecifier.text,
        isTypeOnly: exportIsTypeOnly(node),
        kind: "re-export",
        statementText: node.getText(sourceFile),
      });
    } else if (isDynamicImportCall(node) || isRequireCall(node)) {
      const arg = node.arguments[0];
      const text = arg ? specifierText(arg) : undefined;
      if (text !== undefined) {
        usages.push({
          specifier: text,
          isTypeOnly: false,
          kind: isDynamicImportCall(node) ? "dynamic import()" : "require() call",
          statementText: node.getText(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return usages;
}

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

function parseSource(source: string, name = "synthetic.ts"): ts.SourceFile {
  return ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function parse(file: string): ts.SourceFile {
  return parseSource(fs.readFileSync(file, "utf8"), file);
}

describe("the guard itself", () => {
  const typeOnlyOf = (source: string) => collectModuleUsages(parseSource(source))[0].isTypeOnly;

  it("counts the inline per-specifier type modifier as type-only", () => {
    expect(typeOnlyOf(`import { type Provenance } from "@/db/schema";`)).toBe(true);
    expect(typeOnlyOf(`export { type Provenance } from "@/db/schema";`)).toBe(true);
  });

  it("still counts the declaration form as type-only", () => {
    expect(typeOnlyOf(`import type { Provenance } from "@/db/schema";`)).toBe(true);
  });

  it("counts anything that reaches runtime as a value import", () => {
    expect(typeOnlyOf(`import { getDb } from "@/db/client";`)).toBe(false);
    expect(typeOnlyOf(`import { type Provenance, getDb } from "@/db/client";`)).toBe(false);
    expect(typeOnlyOf(`import db from "@/db/client";`)).toBe(false);
    expect(typeOnlyOf(`import * as db from "@/db/client";`)).toBe(false);
    expect(typeOnlyOf(`import "@/db/client";`)).toBe(false);
  });

  it("forbids the layers the model must not reach, however they are named", () => {
    for (const specifier of ["@/server", "@/server/deps", "@/ui/format", "node:fs", "fs", "child_process", "@/app/actions"]) {
      expect(isForbiddenModule(specifier), specifier).toBe(true);
    }
    for (const specifier of ["@/db/schema", "./taxonomy", "zod"]) {
      expect(isForbiddenModule(specifier), specifier).toBe(false);
    }
  });
});

describe("model layer purity", () => {
  const files = listModelFiles(MODEL_DIR);

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const relative = path.relative(MODEL_DIR, file);

    it(`${relative} imports no other layer`, () => {
      const usages = collectModuleUsages(parse(file));
      for (const usage of usages) {
        expect(
          isForbiddenModule(usage.specifier),
          `${relative}: ${usage.kind} of forbidden module "${usage.specifier}" — ${usage.statementText}`,
        ).toBe(false);
      }
    });

    it(`${relative} imports from @/db only as a type`, () => {
      const usages = collectModuleUsages(parse(file));
      for (const usage of usages.filter((u) => isDbModule(u.specifier))) {
        expect(
          usage.isTypeOnly,
          `${relative}: non-type ${usage.kind} of "@/db" — ${usage.statementText}`,
        ).toBe(true);
      }
    });
  }
});
