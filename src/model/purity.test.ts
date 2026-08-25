import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const MODEL_DIR = path.join(process.cwd(), "src/model");

// Layers the model must never reach into, at runtime, regardless of the
// syntax used to reach them (static import, `require`, dynamic `import()`,
// re-export, template-literal specifier, ...).
function isForbiddenModule(specifier: string): boolean {
  if (/^@\/(app|ingest|extract)(\/|$)/.test(specifier)) return true;
  if (specifier === "next" || specifier.startsWith("next/")) return true;
  if (specifier === "react" || specifier === "react-dom" || specifier === "react/jsx-runtime") return true;
  if (specifier.startsWith("react-dom/")) return true;
  return false;
}

function isDbModule(specifier: string): boolean {
  return specifier === "@/db" || specifier.startsWith("@/db/");
}

interface ModuleUsage {
  /** The static (leading, in the template-literal case) text of the specifier. */
  specifier: string;
  /** True only for `import type ...` / `export type ...` declarations. */
  isTypeOnly: boolean;
  /** How this reference reaches the module — for failure messages. */
  kind: string;
  /** Source text of the enclosing statement — for failure messages. */
  statementText: string;
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
        isTypeOnly: node.importClause?.isTypeOnly ?? false,
        kind: "static import",
        statementText: node.getText(sourceFile),
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      usages.push({
        specifier: node.moduleSpecifier.text,
        isTypeOnly: node.isTypeOnly,
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

function parse(file: string): ts.SourceFile {
  const source = fs.readFileSync(file, "utf8");
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

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
