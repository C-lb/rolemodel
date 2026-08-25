# M1 — Ingest, Extract, Verify — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop a 10-K/10-Q PDF, a case PDF, or an Excel workbook onto a local web app and get canonical, editable financial statements where every figure shows exactly where it came from and every reconciliation failure is surfaced with a fix.

**Architecture:** Four layers with hard boundaries. `ingest/` normalises PDF and spreadsheet inputs to a common shape with no accounting knowledge. `extract/` calls Claude with a Zod-enforced output schema and maps the result to canonical facts with provenance. `model/` is pure TypeScript that layers user overrides over immutable extracted facts and runs deterministic reconciliation checks. `app/` is Next.js routes and React views that hold no financial logic.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind v4, better-sqlite3 + Drizzle ORM, `@anthropic-ai/sdk` + Zod, `unpdf` for PDF text, `exceljs` for workbooks, `@dnd-kit/core` for drag, Vitest for unit tests, Playwright for UI tests.

**Spec:** `docs/superpowers/specs/2026-08-25-financial-modelling-webapp-design.md`

## Global Constraints

- Node 20+ (better-sqlite3 native build requires it). TypeScript `strict: true`, no `any` in committed code.
- Claude model ID is exactly `claude-opus-5`. Never append a date suffix.
- Every Claude request sets `thinking: { type: "adaptive" }`. Never send `budget_tokens` — it returns a 400 on this model.
- Structured extraction uses `client.messages.parse()` with `zodOutputFormat(...)` in `output_config.format`. Never the deprecated top-level `output_format`.
- `response.parsed_output` can be `null`. Always guard; never non-null-assert it in committed code.
- Document citations are incompatible with `output_config.format`. Page provenance comes from schema fields the model fills in, never from the citations API.
- The `model/` directory imports nothing from `app/`, `db/`, `ingest/`, or `extract/`. It is pure functions over plain data. Enforced by a lint test in Task 6.
- Money is stored as a JavaScript number in base currency units (already scaled). Scaling happens once, in `extract/`, and the factor applied is recorded on every fact.
- All monetary comparisons use a tolerance, never `===`. The shared tolerance helper lives in `model/tolerance.ts`.
- Commit after every task. Conventional commit prefixes (`feat:`, `test:`, `chore:`).

---

### Task 1: Project scaffold, canonical taxonomy, and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`
- Create: `src/model/taxonomy.ts`
- Create: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- Test: `src/model/taxonomy.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type StatementKind = "income" | "balance" | "cashflow"`
  - `interface LineItemDef { key: string; statement: StatementKind; label: string; definition: string; order: number; parentKey: string | null; isSubtotal: boolean }`
  - `const TAXONOMY: readonly LineItemDef[]`
  - `function lineItem(key: string): LineItemDef | undefined`
  - `function itemsFor(statement: StatementKind): LineItemDef[]` — sorted by `order`
  - `const UNMAPPED_KEY = "unmapped"`

- [ ] **Step 1: Scaffold the Next.js app**

```bash
cd ~/finmodel
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --yes
npm install @anthropic-ai/sdk zod drizzle-orm better-sqlite3 unpdf exceljs @dnd-kit/core @dnd-kit/sortable
npm install -D vitest @vitejs/plugin-react drizzle-kit @types/better-sqlite3 @playwright/test
```

- [ ] **Step 2: Configure Vitest**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
});
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 3: Write the failing taxonomy test**

Create `src/model/taxonomy.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { TAXONOMY, lineItem, itemsFor } from "./taxonomy";

describe("taxonomy", () => {
  it("has unique keys", () => {
    const keys = TAXONOMY.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every item a non-empty definition for tooltips", () => {
    for (const item of TAXONOMY) {
      expect(item.definition.length, `${item.key} has no definition`).toBeGreaterThan(0);
    }
  });

  it("resolves a known key", () => {
    expect(lineItem("revenue")?.statement).toBe("income");
  });

  it("returns undefined for an unknown key", () => {
    expect(lineItem("not_a_real_line_item")).toBeUndefined();
  });

  it("returns items for a statement sorted by order", () => {
    const items = itemsFor("balance");
    expect(items.length).toBeGreaterThan(5);
    const orders = items.map((i) => i.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("points every parentKey at a real subtotal", () => {
    for (const item of TAXONOMY) {
      if (item.parentKey === null) continue;
      const parent = lineItem(item.parentKey);
      expect(parent, `${item.key} has dangling parent ${item.parentKey}`).toBeDefined();
      expect(parent!.isSubtotal).toBe(true);
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- taxonomy`
Expected: FAIL — cannot resolve `./taxonomy`.

- [ ] **Step 5: Write the taxonomy**

Create `src/model/taxonomy.ts`. Include at minimum the items below; add more only if they are genuinely standard.

```typescript
export type StatementKind = "income" | "balance" | "cashflow";

export interface LineItemDef {
  key: string;
  statement: StatementKind;
  label: string;
  definition: string;
  order: number;
  parentKey: string | null;
  isSubtotal: boolean;
}

export const UNMAPPED_KEY = "unmapped";

export const TAXONOMY: readonly LineItemDef[] = [
  // ---- Income statement ----
  { key: "revenue", statement: "income", label: "Revenue", order: 100, parentKey: null, isSubtotal: false,
    definition: "Total sales of goods and services in the period, net of returns and allowances." },
  { key: "cost_of_revenue", statement: "income", label: "Cost of revenue", order: 110, parentKey: null, isSubtotal: false,
    definition: "Direct costs attributable to producing the goods or services sold." },
  { key: "gross_profit", statement: "income", label: "Gross profit", order: 120, parentKey: null, isSubtotal: true,
    definition: "Revenue less cost of revenue. The margin available to cover operating costs." },
  { key: "research_development", statement: "income", label: "Research and development", order: 130, parentKey: "operating_expenses", isSubtotal: false,
    definition: "Costs of developing new products or services, expensed as incurred under US GAAP." },
  { key: "selling_general_admin", statement: "income", label: "Selling, general and administrative", order: 140, parentKey: "operating_expenses", isSubtotal: false,
    definition: "Overhead not directly tied to production: sales, marketing, corporate functions." },
  { key: "operating_expenses", statement: "income", label: "Total operating expenses", order: 150, parentKey: null, isSubtotal: true,
    definition: "Sum of costs of running the business excluding cost of revenue." },
  { key: "operating_income", statement: "income", label: "Operating income", order: 160, parentKey: null, isSubtotal: true,
    definition: "Gross profit less operating expenses. Profit from core operations before financing and tax." },
  { key: "interest_expense", statement: "income", label: "Interest expense", order: 170, parentKey: null, isSubtotal: false,
    definition: "Cost of borrowed funds for the period." },
  { key: "other_income_expense", statement: "income", label: "Other income (expense)", order: 180, parentKey: null, isSubtotal: false,
    definition: "Non-operating gains and losses not classified elsewhere." },
  { key: "pretax_income", statement: "income", label: "Income before tax", order: 190, parentKey: null, isSubtotal: true,
    definition: "Operating income adjusted for financing and other non-operating items." },
  { key: "income_tax_expense", statement: "income", label: "Income tax expense", order: 200, parentKey: null, isSubtotal: false,
    definition: "Current and deferred tax charged against pre-tax income." },
  { key: "net_income", statement: "income", label: "Net income", order: 210, parentKey: null, isSubtotal: true,
    definition: "Bottom-line profit after all costs, financing and tax." },

  // ---- Balance sheet: assets ----
  { key: "cash_and_equivalents", statement: "balance", label: "Cash and cash equivalents", order: 300, parentKey: "total_current_assets", isSubtotal: false,
    definition: "Cash on hand plus highly liquid investments maturing within three months." },
  { key: "short_term_investments", statement: "balance", label: "Short-term investments", order: 310, parentKey: "total_current_assets", isSubtotal: false,
    definition: "Marketable securities expected to be converted to cash within a year." },
  { key: "accounts_receivable", statement: "balance", label: "Accounts receivable", order: 320, parentKey: "total_current_assets", isSubtotal: false,
    definition: "Amounts owed by customers for goods or services already delivered." },
  { key: "inventory", statement: "balance", label: "Inventory", order: 330, parentKey: "total_current_assets", isSubtotal: false,
    definition: "Raw materials, work in progress and finished goods held for sale." },
  { key: "other_current_assets", statement: "balance", label: "Other current assets", order: 340, parentKey: "total_current_assets", isSubtotal: false,
    definition: "Prepaid expenses and other assets expected to be realised within a year." },
  { key: "total_current_assets", statement: "balance", label: "Total current assets", order: 350, parentKey: null, isSubtotal: true,
    definition: "Assets expected to be converted to cash or consumed within one operating cycle." },
  { key: "property_plant_equipment", statement: "balance", label: "Property, plant and equipment, net", order: 360, parentKey: null, isSubtotal: false,
    definition: "Long-lived physical assets net of accumulated depreciation." },
  { key: "goodwill", statement: "balance", label: "Goodwill", order: 370, parentKey: null, isSubtotal: false,
    definition: "Excess of purchase price over fair value of net assets acquired." },
  { key: "intangible_assets", statement: "balance", label: "Intangible assets, net", order: 380, parentKey: null, isSubtotal: false,
    definition: "Identifiable non-physical assets such as patents and customer relationships, net of amortisation." },
  { key: "other_noncurrent_assets", statement: "balance", label: "Other non-current assets", order: 390, parentKey: null, isSubtotal: false,
    definition: "Long-term assets not classified elsewhere." },
  { key: "total_assets", statement: "balance", label: "Total assets", order: 400, parentKey: null, isSubtotal: true,
    definition: "Everything the company owns or controls. Must equal liabilities plus equity." },

  // ---- Balance sheet: liabilities and equity ----
  { key: "accounts_payable", statement: "balance", label: "Accounts payable", order: 410, parentKey: "total_current_liabilities", isSubtotal: false,
    definition: "Amounts owed to suppliers for goods or services already received." },
  { key: "accrued_liabilities", statement: "balance", label: "Accrued liabilities", order: 420, parentKey: "total_current_liabilities", isSubtotal: false,
    definition: "Expenses incurred but not yet invoiced or paid." },
  { key: "deferred_revenue_current", statement: "balance", label: "Deferred revenue, current", order: 430, parentKey: "total_current_liabilities", isSubtotal: false,
    definition: "Cash collected for goods or services not yet delivered, due within a year." },
  { key: "short_term_debt", statement: "balance", label: "Short-term debt", order: 440, parentKey: "total_current_liabilities", isSubtotal: false,
    definition: "Borrowings and current portion of long-term debt due within a year." },
  { key: "other_current_liabilities", statement: "balance", label: "Other current liabilities", order: 450, parentKey: "total_current_liabilities", isSubtotal: false,
    definition: "Obligations due within a year not classified elsewhere." },
  { key: "total_current_liabilities", statement: "balance", label: "Total current liabilities", order: 460, parentKey: null, isSubtotal: true,
    definition: "Obligations due within one operating cycle." },
  { key: "long_term_debt", statement: "balance", label: "Long-term debt", order: 470, parentKey: null, isSubtotal: false,
    definition: "Borrowings due more than one year out, excluding the current portion." },
  { key: "other_noncurrent_liabilities", statement: "balance", label: "Other non-current liabilities", order: 480, parentKey: null, isSubtotal: false,
    definition: "Long-term obligations not classified elsewhere, such as deferred tax." },
  { key: "total_liabilities", statement: "balance", label: "Total liabilities", order: 490, parentKey: null, isSubtotal: true,
    definition: "Everything the company owes to parties other than its shareholders." },
  { key: "common_stock_apic", statement: "balance", label: "Common stock and additional paid-in capital", order: 500, parentKey: "total_equity", isSubtotal: false,
    definition: "Capital contributed by shareholders in excess of par value." },
  { key: "retained_earnings", statement: "balance", label: "Retained earnings", order: 510, parentKey: "total_equity", isSubtotal: false,
    definition: "Cumulative profits retained in the business rather than paid out as dividends." },
  { key: "treasury_stock", statement: "balance", label: "Treasury stock", order: 520, parentKey: "total_equity", isSubtotal: false,
    definition: "Cost of the company's own shares repurchased and held. A contra-equity account." },
  { key: "accumulated_oci", statement: "balance", label: "Accumulated other comprehensive income", order: 530, parentKey: "total_equity", isSubtotal: false,
    definition: "Unrealised gains and losses bypassing the income statement, such as FX translation." },
  { key: "total_equity", statement: "balance", label: "Total shareholders' equity", order: 540, parentKey: null, isSubtotal: true,
    definition: "Residual claim of shareholders: total assets less total liabilities." },

  // ---- Cash flow ----
  { key: "cf_net_income", statement: "cashflow", label: "Net income", order: 600, parentKey: "cash_from_operations", isSubtotal: false,
    definition: "Starting point of the indirect-method cash-flow statement." },
  { key: "depreciation_amortisation", statement: "cashflow", label: "Depreciation and amortisation", order: 610, parentKey: "cash_from_operations", isSubtotal: false,
    definition: "Non-cash charges added back to net income." },
  { key: "stock_based_compensation", statement: "cashflow", label: "Stock-based compensation", order: 620, parentKey: "cash_from_operations", isSubtotal: false,
    definition: "Non-cash equity compensation expense added back to net income." },
  { key: "change_in_working_capital", statement: "cashflow", label: "Changes in working capital", order: 630, parentKey: "cash_from_operations", isSubtotal: false,
    definition: "Net cash effect of movements in receivables, inventory, payables and accruals." },
  { key: "cash_from_operations", statement: "cashflow", label: "Net cash from operating activities", order: 640, parentKey: null, isSubtotal: true,
    definition: "Cash generated by the core business before investing and financing." },
  { key: "capital_expenditures", statement: "cashflow", label: "Capital expenditures", order: 650, parentKey: "cash_from_investing", isSubtotal: false,
    definition: "Cash spent acquiring property, plant and equipment. Normally negative." },
  { key: "acquisitions", statement: "cashflow", label: "Acquisitions, net of cash acquired", order: 660, parentKey: "cash_from_investing", isSubtotal: false,
    definition: "Cash paid for business combinations." },
  { key: "other_investing", statement: "cashflow", label: "Other investing activities", order: 670, parentKey: "cash_from_investing", isSubtotal: false,
    definition: "Investing cash flows not classified elsewhere, including securities purchases and sales." },
  { key: "cash_from_investing", statement: "cashflow", label: "Net cash from investing activities", order: 680, parentKey: null, isSubtotal: true,
    definition: "Cash used in or generated by asset purchases, disposals and investments." },
  { key: "debt_issued_repaid", statement: "cashflow", label: "Net debt issued (repaid)", order: 690, parentKey: "cash_from_financing", isSubtotal: false,
    definition: "Cash raised from borrowings less repayments of principal." },
  { key: "equity_issued_repurchased", statement: "cashflow", label: "Net equity issued (repurchased)", order: 700, parentKey: "cash_from_financing", isSubtotal: false,
    definition: "Cash from share issuance less cash spent on buybacks." },
  { key: "dividends_paid", statement: "cashflow", label: "Dividends paid", order: 710, parentKey: "cash_from_financing", isSubtotal: false,
    definition: "Cash distributions to shareholders. Normally negative." },
  { key: "other_financing", statement: "cashflow", label: "Other financing activities", order: 720, parentKey: "cash_from_financing", isSubtotal: false,
    definition: "Financing cash flows not classified elsewhere." },
  { key: "cash_from_financing", statement: "cashflow", label: "Net cash from financing activities", order: 730, parentKey: null, isSubtotal: true,
    definition: "Cash raised from or returned to capital providers." },
  { key: "fx_effect_on_cash", statement: "cashflow", label: "Effect of exchange rates on cash", order: 740, parentKey: null, isSubtotal: false,
    definition: "Translation effect of currency movements on foreign cash balances." },
  { key: "net_change_in_cash", statement: "cashflow", label: "Net change in cash", order: 750, parentKey: null, isSubtotal: true,
    definition: "Sum of operating, investing and financing cash flows plus FX effect. Must equal the period-over-period change in balance-sheet cash." },
] as const;

const BY_KEY = new Map(TAXONOMY.map((i) => [i.key, i]));

export function lineItem(key: string): LineItemDef | undefined {
  return BY_KEY.get(key);
}

export function itemsFor(statement: StatementKind): LineItemDef[] {
  return TAXONOMY.filter((i) => i.statement === statement).sort((a, b) => a.order - b.order);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- taxonomy`
Expected: PASS, 6 tests.

- [ ] **Step 7: Write `.env.example` and gitignore the real one**

Create `.env.example`:

```
# Required for extraction. Get one at https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=
# Where uploaded documents and the SQLite file live. Relative to project root.
DATA_DIR=./data
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js app and canonical line-item taxonomy"
```

---

### Task 2: Database schema and migrations

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `drizzle.config.ts`
- Test: `src/db/schema.test.ts`

**Interfaces:**
- Consumes: `StatementKind` from Task 1
- Produces:
  - Drizzle tables: `documents`, `extractionRuns`, `facts`, `workspaces`, `overrides`
  - `function getDb(): BetterSQLite3Database<typeof schema>` — memoised singleton
  - `function migrate(db): void` — creates tables if absent
  - `type Provenance = { page: number | null; sheet: string | null; locator: string; rawLabel: string; rawValue: string; scaleFactor: number; scaleEvidence: string; signFlipped: boolean }`

- [ ] **Step 1: Write the failing test**

Create `src/db/schema.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { migrate } from "./client";

function freshDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db);
  return db;
}

describe("schema", () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it("stores a document and reads it back", () => {
    db.insert(schema.documents).values({
      id: "doc1", filename: "10k.pdf", kind: "pdf", hash: "abc",
      sizeBytes: 100, storagePath: "/tmp/10k.pdf", ingestedAt: 1,
    }).run();
    const rows = db.select().from(schema.documents).where(eq(schema.documents.id, "doc1")).all();
    expect(rows[0].filename).toBe("10k.pdf");
  });

  it("round-trips provenance JSON on a fact", () => {
    db.insert(schema.documents).values({
      id: "doc1", filename: "a.pdf", kind: "pdf", hash: "h",
      sizeBytes: 1, storagePath: "/tmp/a.pdf", ingestedAt: 1,
    }).run();
    db.insert(schema.extractionRuns).values({
      id: "run1", documentId: "doc1", modelId: "claude-opus-5",
      promptVersion: 1, status: "complete", createdAt: 1,
    }).run();
    db.insert(schema.facts).values({
      id: "f1", runId: "run1", canonicalKey: "revenue", periodKey: "FY2024",
      value: 1000, confidence: 0.9,
      provenance: { page: 42, sheet: null, locator: "table-2-row-1", rawLabel: "Net revenue",
                    rawValue: "1,000", scaleFactor: 1000, scaleEvidence: "(in thousands)", signFlipped: false },
    }).run();
    const [fact] = db.select().from(schema.facts).all();
    expect(fact.provenance.page).toBe(42);
    expect(fact.provenance.scaleFactor).toBe(1000);
  });

  it("cascades fact deletion when its run is deleted", () => {
    db.insert(schema.documents).values({
      id: "doc1", filename: "a.pdf", kind: "pdf", hash: "h",
      sizeBytes: 1, storagePath: "/tmp/a.pdf", ingestedAt: 1,
    }).run();
    db.insert(schema.extractionRuns).values({
      id: "run1", documentId: "doc1", modelId: "claude-opus-5",
      promptVersion: 1, status: "complete", createdAt: 1,
    }).run();
    db.insert(schema.facts).values({
      id: "f1", runId: "run1", canonicalKey: "revenue", periodKey: "FY2024", value: 1, confidence: 1,
      provenance: { page: null, sheet: null, locator: "", rawLabel: "", rawValue: "",
                    scaleFactor: 1, scaleEvidence: "", signFlipped: false },
    }).run();
    db.delete(schema.extractionRuns).where(eq(schema.extractionRuns.id, "run1")).run();
    expect(db.select().from(schema.facts).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- schema`
Expected: FAIL — cannot resolve `./schema`.

- [ ] **Step 3: Write the schema**

Create `src/db/schema.ts`:

```typescript
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export interface Provenance {
  page: number | null;
  sheet: string | null;
  locator: string;
  rawLabel: string;
  rawValue: string;
  scaleFactor: number;
  scaleEvidence: string;
  signFlipped: boolean;
}

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  kind: text("kind", { enum: ["pdf", "spreadsheet"] }).notNull(),
  hash: text("hash").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  ingestedAt: integer("ingested_at").notNull(),
});

export const extractionRuns = sqliteTable("extraction_runs", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  promptVersion: integer("prompt_version").notNull(),
  status: text("status", { enum: ["pending", "complete", "failed"] }).notNull(),
  error: text("error"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  createdAt: integer("created_at").notNull(),
});

export const facts = sqliteTable("facts", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => extractionRuns.id, { onDelete: "cascade" }),
  canonicalKey: text("canonical_key").notNull(),
  periodKey: text("period_key").notNull(),
  value: real("value").notNull(),
  confidence: real("confidence").notNull(),
  provenance: text("provenance", { mode: "json" }).$type<Provenance>().notNull(),
}, (t) => ({
  byRun: index("facts_by_run").on(t.runId),
  byKey: index("facts_by_key").on(t.canonicalKey, t.periodKey),
}));

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  activeRunId: text("active_run_id").references(() => extractionRuns.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull(),
});

export const overrides = sqliteTable("overrides", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  canonicalKey: text("canonical_key").notNull(),
  periodKey: text("period_key").notNull(),
  value: real("value").notNull(),
  note: text("note"),
  updatedAt: integer("updated_at").notNull(),
}, (t) => ({
  byWorkspace: index("overrides_by_workspace").on(t.workspaceId),
}));
```

- [ ] **Step 4: Write the client and migrator**

Create `src/db/client.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const DDL = [
  `CREATE TABLE IF NOT EXISTS documents (
     id TEXT PRIMARY KEY, filename TEXT NOT NULL, kind TEXT NOT NULL, hash TEXT NOT NULL,
     size_bytes INTEGER NOT NULL, storage_path TEXT NOT NULL, ingested_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS extraction_runs (
     id TEXT PRIMARY KEY,
     document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     model_id TEXT NOT NULL, prompt_version INTEGER NOT NULL, status TEXT NOT NULL,
     error TEXT, tokens_in INTEGER, tokens_out INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS facts (
     id TEXT PRIMARY KEY,
     run_id TEXT NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
     canonical_key TEXT NOT NULL, period_key TEXT NOT NULL, value REAL NOT NULL,
     confidence REAL NOT NULL, provenance TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS facts_by_run ON facts(run_id)`,
  `CREATE INDEX IF NOT EXISTS facts_by_key ON facts(canonical_key, period_key)`,
  `CREATE TABLE IF NOT EXISTS workspaces (
     id TEXT PRIMARY KEY, name TEXT NOT NULL,
     active_run_id TEXT REFERENCES extraction_runs(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS overrides (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     canonical_key TEXT NOT NULL, period_key TEXT NOT NULL, value REAL NOT NULL,
     note TEXT, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS overrides_by_workspace ON overrides(workspace_id)`,
];

export function migrate(db: Db): void {
  db.run(sql`PRAGMA foreign_keys = ON`);
  for (const statement of DDL) db.run(sql.raw(statement));
}

let cached: Db | null = null;

export function getDb(): Db {
  if (cached) return cached;
  const dataDir = process.env.DATA_DIR ?? "./data";
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(path.join(dataDir, "finmodel.db"));
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  migrate(db);
  cached = db;
  return db;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- schema`
Expected: PASS, 3 tests. If the cascade test fails, confirm `PRAGMA foreign_keys = ON` runs before the inserts.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: sqlite schema for documents, extraction runs, facts and overrides"
```

---

### Task 3: Ingest layer — PDF and spreadsheet normalisation

**Files:**
- Create: `src/ingest/types.ts`, `src/ingest/pdf.ts`, `src/ingest/spreadsheet.ts`, `src/ingest/index.ts`
- Test: `src/ingest/spreadsheet.test.ts`, `src/ingest/index.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `type IngestKind = "pdf" | "spreadsheet"`
  - `interface PdfPage { pageNumber: number; text: string }`
  - `interface SheetGrid { name: string; rows: (string | number | null)[][] }`
  - `interface IngestedDocument { kind: IngestKind; filename: string; bytes: Buffer; pages?: PdfPage[]; sheets?: SheetGrid[] }`
  - `class IngestError extends Error { readonly code: IngestErrorCode }`
  - `type IngestErrorCode = "unsupported_type" | "too_large" | "encrypted_pdf" | "no_text_layer" | "empty_workbook" | "unreadable"`
  - `async function ingest(filename: string, bytes: Buffer): Promise<IngestedDocument>`
  - `const MAX_BYTES = 30 * 1024 * 1024`

- [ ] **Step 1: Write the failing spreadsheet test**

Create `src/ingest/spreadsheet.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { readSpreadsheet } from "./spreadsheet";
import { IngestError } from "./types";

async function workbookBuffer(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("readSpreadsheet", () => {
  it("returns one grid per sheet with values in row order", async () => {
    const buf = await workbookBuffer((wb) => {
      const ws = wb.addWorksheet("Income");
      ws.addRow(["Line item", "FY2024"]);
      ws.addRow(["Revenue", 1000]);
    });
    const sheets = await readSpreadsheet(buf);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Income");
    expect(sheets[0].rows[0]).toEqual(["Line item", "FY2024"]);
    expect(sheets[0].rows[1]).toEqual(["Revenue", 1000]);
  });

  it("uses the computed result for formula cells, not the formula text", async () => {
    const buf = await workbookBuffer((wb) => {
      const ws = wb.addWorksheet("Calc");
      ws.getCell("A1").value = { formula: "1+1", result: 2 };
    });
    const sheets = await readSpreadsheet(buf);
    expect(sheets[0].rows[0][0]).toBe(2);
  });

  it("pads short rows so every row has the same width", async () => {
    const buf = await workbookBuffer((wb) => {
      const ws = wb.addWorksheet("Ragged");
      ws.addRow(["a", "b", "c"]);
      ws.addRow(["d"]);
    });
    const sheets = await readSpreadsheet(buf);
    expect(sheets[0].rows[1]).toEqual(["d", null, null]);
  });

  it("throws empty_workbook when no sheet has any data", async () => {
    const buf = await workbookBuffer((wb) => {
      wb.addWorksheet("Blank");
    });
    await expect(readSpreadsheet(buf)).rejects.toMatchObject({ code: "empty_workbook" });
  });

  it("throws unreadable for bytes that are not a workbook", async () => {
    await expect(readSpreadsheet(Buffer.from("not a spreadsheet"))).rejects.toBeInstanceOf(IngestError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- ingest`
Expected: FAIL — cannot resolve `./spreadsheet`.

- [ ] **Step 3: Write the types module**

Create `src/ingest/types.ts`:

```typescript
export type IngestKind = "pdf" | "spreadsheet";

export interface PdfPage {
  pageNumber: number;
  text: string;
}

export interface SheetGrid {
  name: string;
  rows: (string | number | null)[][];
}

export interface IngestedDocument {
  kind: IngestKind;
  filename: string;
  bytes: Buffer;
  pages?: PdfPage[];
  sheets?: SheetGrid[];
}

export type IngestErrorCode =
  | "unsupported_type"
  | "too_large"
  | "encrypted_pdf"
  | "no_text_layer"
  | "empty_workbook"
  | "unreadable";

export class IngestError extends Error {
  constructor(readonly code: IngestErrorCode, message: string) {
    super(message);
    this.name = "IngestError";
  }
}

export const MAX_BYTES = 30 * 1024 * 1024;
```

- [ ] **Step 4: Write the spreadsheet reader**

Create `src/ingest/spreadsheet.ts`:

```typescript
import ExcelJS from "exceljs";
import { IngestError, type SheetGrid } from "./types";

type CellValue = string | number | null;

function normaliseCell(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "result" in value) {
    const result = (value as ExcelJS.CellFormulaValue).result;
    return typeof result === "number" || typeof result === "string" ? result : null;
  }
  if (typeof value === "object" && "richText" in value) {
    return (value as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("").trim() || null;
  }
  if (typeof value === "object" && "text" in value) {
    return String((value as { text: unknown }).text).trim() || null;
  }
  return null;
}

export async function readSpreadsheet(bytes: Buffer): Promise<SheetGrid[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch (cause) {
    throw new IngestError("unreadable", `Could not read the workbook: ${(cause as Error).message}`);
  }

  const grids: SheetGrid[] = [];
  wb.eachSheet((ws) => {
    const rows: CellValue[][] = [];
    let width = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: CellValue[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(normaliseCell(cell.value)));
      width = Math.max(width, cells.length);
      rows.push(cells);
    });
    const padded = rows.map((r) => [...r, ...Array<CellValue>(width - r.length).fill(null)]);
    if (padded.some((r) => r.some((c) => c !== null))) {
      grids.push({ name: ws.name, rows: padded });
    }
  });

  if (grids.length === 0) {
    throw new IngestError("empty_workbook", "The workbook has no sheets containing data.");
  }
  return grids;
}
```

- [ ] **Step 5: Run to verify the spreadsheet tests pass**

Run: `npm test -- spreadsheet`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the PDF reader**

Create `src/ingest/pdf.ts`:

```typescript
import { extractText, getDocumentProxy } from "unpdf";
import { IngestError, type PdfPage } from "./types";

export async function readPdf(bytes: Buffer): Promise<PdfPage[]> {
  let pageTexts: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const result = await extractText(pdf, { mergePages: false });
    pageTexts = result.text as string[];
  } catch (cause) {
    const message = (cause as Error).message ?? "";
    if (/password|encrypt/i.test(message)) {
      throw new IngestError("encrypted_pdf", "This PDF is password-protected. Remove the password and re-upload.");
    }
    throw new IngestError("unreadable", `Could not read the PDF: ${message}`);
  }

  const pages: PdfPage[] = pageTexts.map((text, i) => ({ pageNumber: i + 1, text: text.trim() }));
  const totalChars = pages.reduce((n, p) => n + p.text.length, 0);
  if (totalChars < 200) {
    throw new IngestError(
      "no_text_layer",
      "This PDF has no extractable text — it is probably a scan. Run OCR on it first, or upload the statements as a spreadsheet.",
    );
  }
  return pages;
}
```

- [ ] **Step 7: Write the dispatcher and its test**

Create `src/ingest/index.ts`:

```typescript
import path from "node:path";
import { readPdf } from "./pdf";
import { readSpreadsheet } from "./spreadsheet";
import { IngestError, MAX_BYTES, type IngestedDocument } from "./types";

export * from "./types";

export async function ingest(filename: string, bytes: Buffer): Promise<IngestedDocument> {
  if (bytes.length > MAX_BYTES) {
    throw new IngestError(
      "too_large",
      `That file is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_BYTES / 1024 / 1024} MB.`,
    );
  }

  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") {
    return { kind: "pdf", filename, bytes, pages: await readPdf(bytes) };
  }
  if (ext === ".xlsx" || ext === ".xls" || ext === ".xlsm") {
    return { kind: "spreadsheet", filename, bytes, sheets: await readSpreadsheet(bytes) };
  }
  throw new IngestError(
    "unsupported_type",
    `${ext || "That file"} is not supported. Upload a PDF (.pdf) or an Excel workbook (.xlsx, .xls, .xlsm).`,
  );
}
```

Create `src/ingest/index.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ingest, MAX_BYTES } from "./index";

describe("ingest", () => {
  it("rejects an unsupported extension by code", async () => {
    await expect(ingest("notes.txt", Buffer.from("hi"))).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("rejects a file over the size limit before parsing it", async () => {
    const big = Buffer.alloc(MAX_BYTES + 1);
    await expect(ingest("huge.pdf", big)).rejects.toMatchObject({ code: "too_large" });
  });

  it("rejects a PDF with no text layer", async () => {
    // A structurally valid but text-free single-page PDF.
    const minimal = Buffer.from(
      "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 99 99]>>endobj\n" +
        "trailer<</Root 1 0 R>>",
      "latin1",
    );
    await expect(ingest("blank.pdf", minimal)).rejects.toMatchObject({
      code: expect.stringMatching(/no_text_layer|unreadable/),
    });
  });
});
```

- [ ] **Step 8: Run the full ingest suite**

Run: `npm test -- ingest`
Expected: PASS, 8 tests total.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: ingest layer normalising PDF and spreadsheet inputs"
```

---

### Task 4: Extraction — Claude with a Zod-enforced schema

**Files:**
- Create: `src/extract/schema.ts`, `src/extract/prompt.ts`, `src/extract/client.ts`, `src/extract/extract.ts`, `src/extract/merge.ts`
- Test: `src/extract/merge.test.ts`, `src/extract/extract.test.ts`

**Interfaces:**
- Consumes: `IngestedDocument` (Task 3), `TAXONOMY` / `lineItem` (Task 1), `Provenance` (Task 2)
- Produces:
  - `const ExtractionSchema` — Zod object; inferred as `ExtractionResult`
  - `interface ExtractedFact { canonicalKey: string; periodKey: string; value: number; confidence: number; provenance: Provenance }`
  - `interface ExtractionOutput { facts: ExtractedFact[]; periods: string[]; conflicts: MergeConflict[]; unmappedLabels: string[]; usage: { tokensIn: number; tokensOut: number } }`
  - `interface MergeConflict { canonicalKey: string; periodKey: string; candidates: ExtractedFact[] }`
  - `type ClaudeCaller = (chunk: ExtractionChunk) => Promise<{ result: ExtractionResult; tokensIn: number; tokensOut: number }>`
  - `async function extractDocument(doc: IngestedDocument, call: ClaudeCaller): Promise<ExtractionOutput>`
  - `function callClaude(chunk: ExtractionChunk): Promise<...>` — the real implementation, injected as `call` in production
  - `const PROMPT_VERSION = 1`

- [ ] **Step 1: Write the Zod schema**

Create `src/extract/schema.ts`:

```typescript
import { z } from "zod";

export const ExtractedFigureSchema = z.object({
  canonical_key: z.string().describe("Canonical line-item key from the supplied list, or 'unmapped'."),
  raw_label: z.string().describe("The label exactly as printed in the source, verbatim."),
  raw_value: z.string().describe("The value exactly as printed, including commas, parentheses and currency symbols."),
  value: z.number().describe("The value converted to base currency units, with the scale factor already applied and parentheses converted to a negative sign."),
  scale_factor: z.number().describe("Multiplier applied to raw_value to reach value: 1, 1000 or 1000000."),
  scale_evidence: z.string().describe("The text in the document that establishes the scale, e.g. '(in thousands, except per share data)'. Empty string if the figures are stated in units."),
  sign_flipped: z.boolean().describe("True if the printed figure was in parentheses or otherwise presented as a negative."),
  period_key: z.string().describe("Period identifier in the form FY2024 or Q2-2025."),
  page: z.number().nullable().describe("1-indexed page number for PDF sources, null for spreadsheets."),
  sheet: z.string().nullable().describe("Sheet name for spreadsheet sources, null for PDFs."),
  locator: z.string().describe("Short human-readable position hint, e.g. 'Consolidated Balance Sheets, row 4'."),
  confidence: z.number().min(0).max(1).describe("How confident you are in this figure and its mapping."),
});

export const ExtractionSchema = z.object({
  periods: z.array(z.string()).describe("Every period present in this content, most recent first."),
  currency: z.string().describe("ISO currency code of the figures, e.g. USD. Empty string if not stated."),
  figures: z.array(ExtractedFigureSchema),
  unmapped_labels: z.array(z.string()).describe("Labels you saw that carried a financial figure but could not be mapped to any canonical key."),
  notes: z.string().describe("Anything ambiguous a reviewer should check. Empty string if nothing."),
});

export type ExtractionResult = z.infer<typeof ExtractionSchema>;
export type ExtractedFigure = z.infer<typeof ExtractedFigureSchema>;
```

- [ ] **Step 2: Write the prompt builder**

Create `src/extract/prompt.ts`:

```typescript
import { TAXONOMY } from "@/model/taxonomy";
import type { IngestedDocument } from "@/ingest";

export const PROMPT_VERSION = 1;

export interface ExtractionChunk {
  label: string;
  /** Text content for spreadsheet chunks, or a page-range description for PDF chunks. */
  text: string;
  /** Present only for PDF chunks: the whole PDF, sent as a document block. */
  pdfBytes?: Buffer;
  pageRange?: { from: number; to: number };
}

export const SYSTEM_PROMPT = [
  "You extract financial statements from source documents into a fixed canonical schema.",
  "",
  "Rules you must follow:",
  "- Report every figure exactly as printed in raw_value, then give the converted number in value.",
  "- Apply the document's stated scale exactly once. If the statement header says '(in thousands)', scale_factor is 1000 and scale_evidence quotes that header. If no scale is stated anywhere, scale_factor is 1 and scale_evidence is an empty string. Never guess a scale from the magnitude of the numbers.",
  "- A figure printed in parentheses is negative. Set sign_flipped true and make value negative.",
  "- Costs, expenses and cash outflows keep the sign convention the document uses. Do not normalise signs to make totals work.",
  "- Never invent a figure that is not printed. If a line is absent, omit it. An omitted line is correct; a fabricated one is not.",
  "- Map each label to the closest canonical key. If nothing fits, use 'unmapped' and also list the label in unmapped_labels.",
  "- Extract subtotals as printed rather than recomputing them. A subtotal that disagrees with its components is information the reviewer needs.",
  "- page is the 1-indexed page the figure is printed on. Get this right; a reader will click through to check it.",
].join("\n");

function taxonomyBlock(): string {
  return TAXONOMY.map((i) => `${i.key} [${i.statement}] — ${i.label}: ${i.definition}`).join("\n");
}

export function buildUserPrompt(chunk: ExtractionChunk): string {
  return [
    "Canonical line-item keys:",
    taxonomyBlock(),
    "",
    chunk.pageRange
      ? `Extract every financial-statement figure printed on pages ${chunk.pageRange.from} to ${chunk.pageRange.to} of the attached document. Ignore pages outside that range.`
      : "Extract every financial-statement figure from the content below.",
    "",
    chunk.text,
  ].join("\n");
}

/** Splits an ingested document into chunks small enough to extract reliably. */
export function chunkDocument(doc: IngestedDocument): ExtractionChunk[] {
  if (doc.kind === "pdf") {
    const pages = doc.pages ?? [];
    // Only pages that plausibly contain a statement are worth sending.
    const interesting = pages.filter((p) => /total (assets|liabilities)|net (income|revenue|sales)|cash (flow|and cash)|balance sheet|statements? of operations/i.test(p.text));
    const targets = interesting.length > 0 ? interesting : pages;
    const PAGES_PER_CHUNK = 6;
    const chunks: ExtractionChunk[] = [];
    for (let i = 0; i < targets.length; i += PAGES_PER_CHUNK) {
      const slice = targets.slice(i, i + PAGES_PER_CHUNK);
      chunks.push({
        label: `pages ${slice[0].pageNumber}-${slice[slice.length - 1].pageNumber}`,
        text: slice.map((p) => `--- page ${p.pageNumber} ---\n${p.text}`).join("\n\n"),
        pdfBytes: doc.bytes,
        pageRange: { from: slice[0].pageNumber, to: slice[slice.length - 1].pageNumber },
      });
    }
    return chunks;
  }

  return (doc.sheets ?? []).map((sheet) => ({
    label: `sheet ${sheet.name}`,
    text: [
      `Sheet name: ${sheet.name}`,
      "Rows, tab-separated, in order:",
      ...sheet.rows.map((row, i) => `${i + 1}\t${row.map((c) => (c === null ? "" : String(c))).join("\t")}`),
    ].join("\n"),
  }));
}
```

- [ ] **Step 3: Write the Claude caller**

Create `src/extract/client.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ExtractionSchema, type ExtractionResult } from "./schema";
import { SYSTEM_PROMPT, buildUserPrompt, type ExtractionChunk } from "./prompt";

export const MODEL_ID = "claude-opus-5";

export class MissingApiKeyError extends Error {
  readonly code = "missing_api_key";
  constructor() {
    super("ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the server.");
    this.name = "MissingApiKeyError";
  }
}

export class ExtractionRefusedError extends Error {
  readonly code = "refused";
  constructor(readonly category: string | null) {
    super("The model declined to process this document.");
    this.name = "ExtractionRefusedError";
  }
}

export interface CallResult {
  result: ExtractionResult;
  tokensIn: number;
  tokensOut: number;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingApiKeyError();
  client ??= new Anthropic();
  return client;
}

export async function callClaude(chunk: ExtractionChunk): Promise<CallResult> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (chunk.pdfBytes) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: chunk.pdfBytes.toString("base64"),
      },
    });
  }
  content.push({ type: "text", text: buildUserPrompt(chunk) });

  const response = await getClient().messages.parse({
    model: MODEL_ID,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new ExtractionRefusedError(response.stop_details?.category ?? null);
  }
  if (!response.parsed_output) {
    throw new Error(`Extraction returned no parsable output for ${chunk.label}.`);
  }

  return {
    result: response.parsed_output,
    tokensIn: response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
  };
}
```

- [ ] **Step 4: Write the failing merge test**

Create `src/extract/merge.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mergeFigures } from "./merge";
import type { ExtractedFigure } from "./schema";

function figure(over: Partial<ExtractedFigure> = {}): ExtractedFigure {
  return {
    canonical_key: "revenue", raw_label: "Revenue", raw_value: "1,000", value: 1000,
    scale_factor: 1000, scale_evidence: "(in thousands)", sign_flipped: false,
    period_key: "FY2024", page: 5, sheet: null, locator: "row 1", confidence: 0.9,
    ...over,
  };
}

describe("mergeFigures", () => {
  it("keeps one fact per key and period", () => {
    const out = mergeFigures([figure(), figure({ canonical_key: "net_income", value: 200 })]);
    expect(out.facts).toHaveLength(2);
    expect(out.conflicts).toHaveLength(0);
  });

  it("treats identical values from two chunks as one fact, not a conflict", () => {
    const out = mergeFigures([figure(), figure({ page: 6 })]);
    expect(out.facts).toHaveLength(1);
    expect(out.conflicts).toHaveLength(0);
  });

  it("records a conflict when the same key and period disagree", () => {
    const out = mergeFigures([figure({ value: 1000 }), figure({ value: 1200 })]);
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0].candidates).toHaveLength(2);
  });

  it("keeps the higher-confidence candidate as the active fact on conflict", () => {
    const out = mergeFigures([
      figure({ value: 1000, confidence: 0.4 }),
      figure({ value: 1200, confidence: 0.95 }),
    ]);
    expect(out.facts[0].value).toBe(1200);
  });

  it("drops unmapped figures from facts but reports their labels", () => {
    const out = mergeFigures([figure({ canonical_key: "unmapped", raw_label: "Weird line" })]);
    expect(out.facts).toHaveLength(0);
    expect(out.unmappedLabels).toContain("Weird line");
  });

  it("drops figures whose canonical key is not in the taxonomy", () => {
    const out = mergeFigures([figure({ canonical_key: "made_up_key", raw_label: "Ghost" })]);
    expect(out.facts).toHaveLength(0);
    expect(out.unmappedLabels).toContain("Ghost");
  });

  it("collects the union of periods, most recent first", () => {
    const out = mergeFigures([figure({ period_key: "FY2023" }), figure({ period_key: "FY2024", canonical_key: "net_income" })]);
    expect(out.periods).toEqual(["FY2024", "FY2023"]);
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npm test -- merge`
Expected: FAIL — cannot resolve `./merge`.

- [ ] **Step 6: Write the merger**

Create `src/extract/merge.ts`:

```typescript
import { lineItem, UNMAPPED_KEY } from "@/model/taxonomy";
import type { Provenance } from "@/db/schema";
import type { ExtractedFigure } from "./schema";

export interface ExtractedFact {
  canonicalKey: string;
  periodKey: string;
  value: number;
  confidence: number;
  provenance: Provenance;
}

export interface MergeConflict {
  canonicalKey: string;
  periodKey: string;
  candidates: ExtractedFact[];
}

export interface MergeOutput {
  facts: ExtractedFact[];
  periods: string[];
  conflicts: MergeConflict[];
  unmappedLabels: string[];
}

function toFact(f: ExtractedFigure): ExtractedFact {
  return {
    canonicalKey: f.canonical_key,
    periodKey: f.period_key,
    value: f.value,
    confidence: f.confidence,
    provenance: {
      page: f.page,
      sheet: f.sheet,
      locator: f.locator,
      rawLabel: f.raw_label,
      rawValue: f.raw_value,
      scaleFactor: f.scale_factor,
      scaleEvidence: f.scale_evidence,
      signFlipped: f.sign_flipped,
    },
  };
}

/** FY2024 sorts above FY2023; Q2-2025 above Q1-2025. Unrecognised keys sort last, stably. */
function periodRank(key: string): number {
  const fy = /^FY(\d{4})$/.exec(key);
  if (fy) return Number(fy[1]) * 10 + 9;
  const q = /^Q([1-4])-(\d{4})$/.exec(key);
  if (q) return Number(q[2]) * 10 + Number(q[1]);
  return -1;
}

export function mergeFigures(figures: ExtractedFigure[]): MergeOutput {
  const buckets = new Map<string, ExtractedFact[]>();
  const unmappedLabels: string[] = [];
  const periods = new Set<string>();

  for (const figure of figures) {
    periods.add(figure.period_key);
    const known = lineItem(figure.canonical_key);
    if (!known || figure.canonical_key === UNMAPPED_KEY) {
      unmappedLabels.push(figure.raw_label);
      continue;
    }
    const id = `${figure.canonical_key}::${figure.period_key}`;
    const list = buckets.get(id) ?? [];
    list.push(toFact(figure));
    buckets.set(id, list);
  }

  const facts: ExtractedFact[] = [];
  const conflicts: MergeConflict[] = [];

  for (const [id, candidates] of buckets) {
    const distinct = new Set(candidates.map((c) => c.value));
    const best = [...candidates].sort((a, b) => b.confidence - a.confidence)[0];
    facts.push(best);
    if (distinct.size > 1) {
      const [canonicalKey, periodKey] = id.split("::");
      conflicts.push({ canonicalKey, periodKey, candidates });
    }
  }

  return {
    facts,
    periods: [...periods].sort((a, b) => periodRank(b) - periodRank(a)),
    conflicts,
    unmappedLabels: [...new Set(unmappedLabels)],
  };
}
```

- [ ] **Step 7: Run to verify merge passes**

Run: `npm test -- merge`
Expected: PASS, 7 tests.

- [ ] **Step 8: Write the orchestrator and its test**

Create `src/extract/extract.ts`:

```typescript
import type { IngestedDocument } from "@/ingest";
import { chunkDocument, type ExtractionChunk } from "./prompt";
import { mergeFigures, type MergeOutput } from "./merge";
import type { ExtractionResult } from "./schema";

export type ClaudeCaller = (chunk: ExtractionChunk) => Promise<{
  result: ExtractionResult;
  tokensIn: number;
  tokensOut: number;
}>;

export interface ExtractionOutput extends MergeOutput {
  usage: { tokensIn: number; tokensOut: number };
  chunkErrors: { label: string; message: string }[];
}

export async function extractDocument(
  doc: IngestedDocument,
  call: ClaudeCaller,
): Promise<ExtractionOutput> {
  const chunks = chunkDocument(doc);
  if (chunks.length === 0) {
    throw new Error("There was nothing in this document to extract.");
  }

  const settled = await Promise.allSettled(chunks.map((chunk) => call(chunk)));

  const figures = [];
  const chunkErrors: { label: string; message: string }[] = [];
  let tokensIn = 0;
  let tokensOut = 0;

  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      chunkErrors.push({ label: chunks[i].label, message: (outcome.reason as Error).message });
      continue;
    }
    figures.push(...outcome.value.result.figures);
    tokensIn += outcome.value.tokensIn;
    tokensOut += outcome.value.tokensOut;
  }

  if (figures.length === 0) {
    const detail = chunkErrors.map((e) => `${e.label}: ${e.message}`).join("; ");
    throw new Error(`Extraction produced no figures. ${detail || "The document may not contain financial statements."}`);
  }

  return { ...mergeFigures(figures), usage: { tokensIn, tokensOut }, chunkErrors };
}
```

Create `src/extract/extract.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { extractDocument } from "./extract";
import type { IngestedDocument } from "@/ingest";
import type { ExtractionResult } from "./schema";

const sheetDoc: IngestedDocument = {
  kind: "spreadsheet",
  filename: "model.xlsx",
  bytes: Buffer.alloc(0),
  sheets: [
    { name: "IS", rows: [["Revenue", 1000]] },
    { name: "BS", rows: [["Total assets", 5000]] },
  ],
};

function result(over: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    periods: ["FY2024"], currency: "USD", figures: [], unmapped_labels: [], notes: "", ...over,
  };
}

function figure(key: string, value: number) {
  return {
    canonical_key: key, raw_label: key, raw_value: String(value), value,
    scale_factor: 1, scale_evidence: "", sign_flipped: false, period_key: "FY2024",
    page: null, sheet: "IS", locator: "row 1", confidence: 0.9,
  };
}

describe("extractDocument", () => {
  it("sends one chunk per sheet and merges the figures", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ result: result({ figures: [figure("revenue", 1000)] }), tokensIn: 10, tokensOut: 5 })
      .mockResolvedValueOnce({ result: result({ figures: [figure("total_assets", 5000)] }), tokensIn: 12, tokensOut: 6 });

    const out = await extractDocument(sheetDoc, call);

    expect(call).toHaveBeenCalledTimes(2);
    expect(out.facts.map((f) => f.canonicalKey).sort()).toEqual(["revenue", "total_assets"]);
    expect(out.usage).toEqual({ tokensIn: 22, tokensOut: 11 });
  });

  it("keeps the figures from surviving chunks when one chunk fails", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ result: result({ figures: [figure("revenue", 1000)] }), tokensIn: 1, tokensOut: 1 })
      .mockRejectedValueOnce(new Error("overloaded"));

    const out = await extractDocument(sheetDoc, call);

    expect(out.facts).toHaveLength(1);
    expect(out.chunkErrors).toEqual([{ label: "sheet BS", message: "overloaded" }]);
  });

  it("throws when every chunk fails", async () => {
    const call = vi.fn().mockRejectedValue(new Error("overloaded"));
    await expect(extractDocument(sheetDoc, call)).rejects.toThrow(/no figures/i);
  });

  it("throws when the document yields no chunks", async () => {
    const empty: IngestedDocument = { kind: "spreadsheet", filename: "e.xlsx", bytes: Buffer.alloc(0), sheets: [] };
    await expect(extractDocument(empty, vi.fn())).rejects.toThrow(/nothing in this document/i);
  });
});
```

- [ ] **Step 9: Run the extraction suite**

Run: `npm test -- extract`
Expected: PASS, 11 tests across merge and extract.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: Claude-backed extraction with schema-enforced provenance and chunk merging"
```

---

### Task 5: Reconciliation validation gate

**Files:**
- Create: `src/model/tolerance.ts`, `src/model/validate.ts`
- Test: `src/model/validate.test.ts`

**Interfaces:**
- Consumes: `TAXONOMY` / `lineItem` (Task 1)
- Produces:
  - `function closeEnough(a: number, b: number): boolean` — relative tolerance 0.5%, absolute floor 1
  - `type FindingSeverity = "blocking" | "warning"`
  - `interface Finding { code: FindingCode; severity: FindingSeverity; periodKey: string | null; message: string; remediation: string; keys: string[] }`
  - `type FindingCode = "balance_sheet_imbalance" | "cashflow_tie_out" | "subtotal_mismatch" | "missing_periods" | "missing_statement" | "low_confidence" | "scale_inconsistent" | "merge_conflict"`
  - `interface ValueLookup { (canonicalKey: string, periodKey: string): number | undefined }`
  - `function validate(input: ValidateInput): Finding[]`
  - `interface ValidateInput { periods: string[]; valueAt: ValueLookup; confidenceAt?: (k: string, p: string) => number | undefined; scaleFactors?: number[]; conflicts?: { canonicalKey: string; periodKey: string }[] }`

- [ ] **Step 1: Write the failing test**

Create `src/model/validate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validate, type ValidateInput } from "./validate";
import { closeEnough } from "./tolerance";

function lookupFrom(data: Record<string, Record<string, number>>) {
  return (key: string, period: string) => data[period]?.[key];
}

const balanced = {
  FY2024: {
    total_assets: 1000, total_liabilities: 600, total_equity: 400,
    cash_and_equivalents: 100,
    cash_from_operations: 90, cash_from_investing: -40, cash_from_financing: -20,
    fx_effect_on_cash: 0, net_change_in_cash: 30,
  },
  FY2023: {
    total_assets: 900, total_liabilities: 550, total_equity: 350,
    cash_and_equivalents: 70,
  },
};

function input(over: Partial<ValidateInput> = {}): ValidateInput {
  return { periods: ["FY2024", "FY2023"], valueAt: lookupFrom(balanced), ...over };
}

describe("closeEnough", () => {
  it("accepts a rounding-scale difference on a large number", () => {
    expect(closeEnough(1_000_000, 1_000_400)).toBe(true);
  });
  it("rejects a material difference", () => {
    expect(closeEnough(1_000_000, 1_050_000)).toBe(false);
  });
  it("accepts a sub-unit difference on a small number", () => {
    expect(closeEnough(0, 0.4)).toBe(true);
  });
});

describe("validate", () => {
  it("returns no blocking findings for consistent statements", () => {
    const findings = validate(input());
    expect(findings.filter((f) => f.severity === "blocking")).toEqual([]);
  });

  it("flags a balance sheet that does not balance", () => {
    const broken = { ...balanced, FY2024: { ...balanced.FY2024, total_equity: 350 } };
    const findings = validate(input({ valueAt: lookupFrom(broken) }));
    const finding = findings.find((f) => f.code === "balance_sheet_imbalance");
    expect(finding?.severity).toBe("blocking");
    expect(finding?.periodKey).toBe("FY2024");
    expect(finding?.keys).toContain("total_assets");
    expect(finding?.remediation.length).toBeGreaterThan(0);
  });

  it("flags a cash-flow statement whose components do not sum to net change", () => {
    const broken = { ...balanced, FY2024: { ...balanced.FY2024, net_change_in_cash: 999 } };
    const findings = validate(input({ valueAt: lookupFrom(broken) }));
    expect(findings.some((f) => f.code === "cashflow_tie_out")).toBe(true);
  });

  it("flags net change in cash that disagrees with the balance-sheet cash movement", () => {
    // BS cash moves 70 -> 100 = 30. Make the CF say 50 while still summing internally.
    const broken = {
      ...balanced,
      FY2024: { ...balanced.FY2024, cash_from_operations: 110, net_change_in_cash: 50 },
    };
    const findings = validate(input({ valueAt: lookupFrom(broken) }));
    expect(findings.filter((f) => f.code === "cashflow_tie_out").length).toBeGreaterThan(0);
  });

  it("does not flag cash tie-out for the earliest period, which has no prior", () => {
    const findings = validate(input());
    expect(findings.some((f) => f.code === "cashflow_tie_out" && f.periodKey === "FY2023")).toBe(false);
  });

  it("flags a subtotal that disagrees with its components", () => {
    const data = {
      FY2024: {
        ...balanced.FY2024,
        total_current_assets: 500, cash_and_equivalents: 100, accounts_receivable: 100,
      },
    };
    const findings = validate({ periods: ["FY2024"], valueAt: lookupFrom(data) });
    const finding = findings.find((f) => f.code === "subtotal_mismatch");
    expect(finding?.severity).toBe("warning");
    expect(finding?.keys).toContain("total_current_assets");
  });

  it("flags a missing statement when no cash-flow figures are present", () => {
    const data = { FY2024: { total_assets: 100, total_liabilities: 60, total_equity: 40 } };
    const findings = validate({ periods: ["FY2024"], valueAt: lookupFrom(data) });
    expect(findings.some((f) => f.code === "missing_statement")).toBe(true);
  });

  it("flags low-confidence figures as warnings", () => {
    const findings = validate(input({
      confidenceAt: (k) => (k === "total_assets" ? 0.3 : 0.95),
    }));
    const finding = findings.find((f) => f.code === "low_confidence");
    expect(finding?.severity).toBe("warning");
    expect(finding?.keys).toContain("total_assets");
  });

  it("flags inconsistent scale factors across the document", () => {
    const findings = validate(input({ scaleFactors: [1000, 1_000_000] }));
    expect(findings.some((f) => f.code === "scale_inconsistent")).toBe(true);
  });

  it("turns merge conflicts into blocking findings", () => {
    const findings = validate(input({ conflicts: [{ canonicalKey: "revenue", periodKey: "FY2024" }] }));
    const finding = findings.find((f) => f.code === "merge_conflict");
    expect(finding?.severity).toBe("blocking");
  });

  it("gives every finding a non-empty remediation", () => {
    const broken = { ...balanced, FY2024: { ...balanced.FY2024, total_equity: 1 } };
    const findings = validate(input({ valueAt: lookupFrom(broken), scaleFactors: [1, 1000] }));
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.remediation.length, f.code).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- validate`
Expected: FAIL — cannot resolve `./validate`.

- [ ] **Step 3: Write the tolerance helper**

Create `src/model/tolerance.ts`:

```typescript
const RELATIVE = 0.005;
const ABSOLUTE_FLOOR = 1;

/** True when two money figures agree within rounding noise. Never compare money with ===. */
export function closeEnough(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(ABSOLUTE_FLOOR, scale * RELATIVE);
}
```

- [ ] **Step 4: Write the validator**

Create `src/model/validate.ts`:

```typescript
import { TAXONOMY, lineItem, type StatementKind } from "./taxonomy";
import { closeEnough } from "./tolerance";

export type FindingSeverity = "blocking" | "warning";

export type FindingCode =
  | "balance_sheet_imbalance"
  | "cashflow_tie_out"
  | "subtotal_mismatch"
  | "missing_periods"
  | "missing_statement"
  | "low_confidence"
  | "scale_inconsistent"
  | "merge_conflict";

export interface Finding {
  code: FindingCode;
  severity: FindingSeverity;
  periodKey: string | null;
  message: string;
  remediation: string;
  keys: string[];
}

export type ValueLookup = (canonicalKey: string, periodKey: string) => number | undefined;

export interface ValidateInput {
  periods: string[];
  valueAt: ValueLookup;
  confidenceAt?: (canonicalKey: string, periodKey: string) => number | undefined;
  scaleFactors?: number[];
  conflicts?: { canonicalKey: string; periodKey: string }[];
}

const LOW_CONFIDENCE = 0.6;
const CF_COMPONENTS = ["cash_from_operations", "cash_from_investing", "cash_from_financing", "fx_effect_on_cash"];

function money(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function statementHasData(statement: StatementKind, periods: string[], valueAt: ValueLookup): boolean {
  return TAXONOMY.some(
    (item) => item.statement === statement && periods.some((p) => valueAt(item.key, p) !== undefined),
  );
}

export function validate(input: ValidateInput): Finding[] {
  const { periods, valueAt } = input;
  const findings: Finding[] = [];

  if (periods.length === 0) {
    return [{
      code: "missing_periods", severity: "blocking", periodKey: null, keys: [],
      message: "No reporting periods were found in this document.",
      remediation: "Check that the upload contains financial statements, then re-run extraction.",
    }];
  }

  for (const statement of ["income", "balance", "cashflow"] as StatementKind[]) {
    if (!statementHasData(statement, periods, valueAt)) {
      findings.push({
        code: "missing_statement", severity: "warning", periodKey: null, keys: [],
        message: `No ${statement} statement figures were extracted.`,
        remediation: "If the statement is in the document, re-run extraction over its page range. Otherwise upload the missing statement separately.",
      });
    }
  }

  // Ordered most recent first, so the prior period is the next entry.
  for (const [i, period] of periods.entries()) {
    const assets = valueAt("total_assets", period);
    const liabilities = valueAt("total_liabilities", period);
    const equity = valueAt("total_equity", period);

    if (assets !== undefined && liabilities !== undefined && equity !== undefined) {
      if (!closeEnough(assets, liabilities + equity)) {
        const gap = assets - (liabilities + equity);
        findings.push({
          code: "balance_sheet_imbalance", severity: "blocking", periodKey: period,
          keys: ["total_assets", "total_liabilities", "total_equity"],
          message: `${period}: assets of ${money(assets)} do not equal liabilities plus equity of ${money(liabilities + equity)}. Gap ${money(gap)}.`,
          remediation: "Open the balance sheet for this period and check the three totals against the source pages. A gap equal to a single line item usually means that item was missed or double-counted.",
        });
      }
    }

    const components = CF_COMPONENTS.map((k) => valueAt(k, period)).filter((v): v is number => v !== undefined);
    const netChange = valueAt("net_change_in_cash", period);
    if (netChange !== undefined && components.length >= 3) {
      const sum = components.reduce((a, b) => a + b, 0);
      if (!closeEnough(sum, netChange)) {
        findings.push({
          code: "cashflow_tie_out", severity: "blocking", periodKey: period,
          keys: [...CF_COMPONENTS, "net_change_in_cash"],
          message: `${period}: operating, investing and financing cash flows sum to ${money(sum)} but net change in cash is ${money(netChange)}.`,
          remediation: "Check the three section subtotals and the FX line against the source. A sign error on one section is the usual cause.",
        });
      }
    }

    const priorPeriod = periods[i + 1];
    const cashNow = valueAt("cash_and_equivalents", period);
    const cashPrior = priorPeriod ? valueAt("cash_and_equivalents", priorPeriod) : undefined;
    if (netChange !== undefined && cashNow !== undefined && cashPrior !== undefined) {
      if (!closeEnough(cashNow - cashPrior, netChange)) {
        findings.push({
          code: "cashflow_tie_out", severity: "blocking", periodKey: period,
          keys: ["cash_and_equivalents", "net_change_in_cash"],
          message: `${period}: balance-sheet cash moved by ${money(cashNow - cashPrior)} but the cash-flow statement reports a net change of ${money(netChange)}.`,
          remediation: "Confirm the balance-sheet cash line excludes short-term investments, and that both periods use the same scale.",
        });
      }
    }

    for (const subtotal of TAXONOMY.filter((i) => i.isSubtotal)) {
      const children = TAXONOMY.filter((i) => i.parentKey === subtotal.key);
      if (children.length === 0) continue;
      const values = children.map((c) => valueAt(c.key, period));
      if (values.some((v) => v === undefined)) continue;
      const sum = values.reduce<number>((a, b) => a + (b as number), 0);
      const reported = valueAt(subtotal.key, period);
      if (reported === undefined || closeEnough(sum, reported)) continue;
      findings.push({
        code: "subtotal_mismatch", severity: "warning", periodKey: period,
        keys: [subtotal.key, ...children.map((c) => c.key)],
        message: `${period}: ${subtotal.label} is reported as ${money(reported)} but its components sum to ${money(sum)}.`,
        remediation: "This is often correct — the source may include a line the taxonomy does not model. Check the source page, and add the missing amount to the closest 'other' line if so.",
      });
    }

    if (input.confidenceAt) {
      const lowKeys = TAXONOMY
        .filter((item) => {
          const c = input.confidenceAt!(item.key, period);
          return c !== undefined && c < LOW_CONFIDENCE;
        })
        .map((item) => item.key);
      if (lowKeys.length > 0) {
        findings.push({
          code: "low_confidence", severity: "warning", periodKey: period, keys: lowKeys,
          message: `${period}: ${lowKeys.length} figure${lowKeys.length === 1 ? "" : "s"} were extracted with low confidence.`,
          remediation: "Open each flagged figure's provenance panel and compare it against the source page before relying on it.",
        });
      }
    }
  }

  const scales = [...new Set(input.scaleFactors ?? [])];
  if (scales.length > 1) {
    findings.push({
      code: "scale_inconsistent", severity: "blocking", periodKey: null, keys: [],
      message: `Figures in this document were scaled by more than one factor (${scales.map(money).join(", ")}).`,
      remediation: "Statements presented in different units are a common source of silent errors. Check each statement's header and correct the affected figures.",
    });
  }

  for (const conflict of input.conflicts ?? []) {
    const label = lineItem(conflict.canonicalKey)?.label ?? conflict.canonicalKey;
    findings.push({
      code: "merge_conflict", severity: "blocking", periodKey: conflict.periodKey,
      keys: [conflict.canonicalKey],
      message: `${conflict.periodKey}: ${label} was extracted with more than one value.`,
      remediation: "Compare the candidates against the source pages and keep the correct one. The higher-confidence value is currently active.",
    });
  }

  return findings;
}
```

- [ ] **Step 5: Run to verify the validator passes**

Run: `npm test -- validate`
Expected: PASS, 14 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: deterministic reconciliation gate with remediation-carrying findings"
```

---

### Task 6: Workspace model — override layering and purity guard

**Files:**
- Create: `src/model/workspace.ts`
- Test: `src/model/workspace.test.ts`, `src/model/purity.test.ts`

**Interfaces:**
- Consumes: `Finding` / `validate` (Task 5), `TAXONOMY` (Task 1), `Provenance` (Task 2)
- Produces:
  - `interface Cell { canonicalKey: string; periodKey: string; value: number | undefined; source: "extracted" | "override" | "absent"; extractedValue: number | undefined; confidence: number | undefined; provenance: Provenance | undefined }`
  - `interface WorkspaceInput { periods: string[]; facts: ExtractedFactLike[]; overrides: OverrideLike[]; scaleFactors?: number[]; conflicts?: { canonicalKey: string; periodKey: string }[] }`
  - `interface WorkspaceView { periods: string[]; cell(key: string, period: string): Cell; statement(kind: StatementKind): StatementRow[]; findings: Finding[] }`
  - `interface StatementRow { def: LineItemDef; cells: Cell[] }`
  - `function buildWorkspace(input: WorkspaceInput): WorkspaceView`

- [ ] **Step 1: Write the failing test**

Create `src/model/workspace.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildWorkspace, type WorkspaceInput } from "./workspace";
import type { Provenance } from "@/db/schema";

const prov: Provenance = {
  page: 3, sheet: null, locator: "row 2", rawLabel: "Net revenue", rawValue: "1,000",
  scaleFactor: 1000, scaleEvidence: "(in thousands)", signFlipped: false,
};

function input(over: Partial<WorkspaceInput> = {}): WorkspaceInput {
  return {
    periods: ["FY2024"],
    facts: [{ canonicalKey: "revenue", periodKey: "FY2024", value: 1000, confidence: 0.9, provenance: prov }],
    overrides: [],
    ...over,
  };
}

describe("buildWorkspace", () => {
  it("exposes an extracted fact as a cell with its provenance", () => {
    const cell = buildWorkspace(input()).cell("revenue", "FY2024");
    expect(cell.value).toBe(1000);
    expect(cell.source).toBe("extracted");
    expect(cell.provenance?.page).toBe(3);
  });

  it("shadows an extracted value with an override and keeps the original visible", () => {
    const ws = buildWorkspace(input({
      overrides: [{ canonicalKey: "revenue", periodKey: "FY2024", value: 1234 }],
    }));
    const cell = ws.cell("revenue", "FY2024");
    expect(cell.value).toBe(1234);
    expect(cell.source).toBe("override");
    expect(cell.extractedValue).toBe(1000);
    expect(cell.provenance?.rawValue).toBe("1,000");
  });

  it("supports an override on a line item that was never extracted", () => {
    const ws = buildWorkspace(input({
      overrides: [{ canonicalKey: "inventory", periodKey: "FY2024", value: 50 }],
    }));
    const cell = ws.cell("inventory", "FY2024");
    expect(cell.value).toBe(50);
    expect(cell.source).toBe("override");
    expect(cell.extractedValue).toBeUndefined();
  });

  it("reports an absent cell rather than throwing", () => {
    const cell = buildWorkspace(input()).cell("goodwill", "FY2024");
    expect(cell.value).toBeUndefined();
    expect(cell.source).toBe("absent");
  });

  it("returns statement rows in taxonomy order with one cell per period", () => {
    const ws = buildWorkspace(input({ periods: ["FY2024", "FY2023"] }));
    const rows = ws.statement("income");
    expect(rows[0].def.key).toBe("revenue");
    expect(rows[0].cells).toHaveLength(2);
    const orders = rows.map((r) => r.def.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("runs validation over override-adjusted values, not raw extracted ones", () => {
    const facts = [
      { canonicalKey: "total_assets", periodKey: "FY2024", value: 1000, confidence: 1, provenance: prov },
      { canonicalKey: "total_liabilities", periodKey: "FY2024", value: 600, confidence: 1, provenance: prov },
      { canonicalKey: "total_equity", periodKey: "FY2024", value: 1, confidence: 1, provenance: prov },
    ];
    const broken = buildWorkspace(input({ facts, overrides: [] }));
    expect(broken.findings.some((f) => f.code === "balance_sheet_imbalance")).toBe(true);

    const fixed = buildWorkspace(input({
      facts,
      overrides: [{ canonicalKey: "total_equity", periodKey: "FY2024", value: 400 }],
    }));
    expect(fixed.findings.some((f) => f.code === "balance_sheet_imbalance")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- workspace`
Expected: FAIL — cannot resolve `./workspace`.

- [ ] **Step 3: Write the workspace builder**

Create `src/model/workspace.ts`:

```typescript
import { itemsFor, type LineItemDef, type StatementKind } from "./taxonomy";
import { validate, type Finding } from "./validate";
import type { Provenance } from "@/db/schema";

export interface ExtractedFactLike {
  canonicalKey: string;
  periodKey: string;
  value: number;
  confidence: number;
  provenance: Provenance;
}

export interface OverrideLike {
  canonicalKey: string;
  periodKey: string;
  value: number;
}

export interface Cell {
  canonicalKey: string;
  periodKey: string;
  value: number | undefined;
  source: "extracted" | "override" | "absent";
  extractedValue: number | undefined;
  confidence: number | undefined;
  provenance: Provenance | undefined;
}

export interface StatementRow {
  def: LineItemDef;
  cells: Cell[];
}

export interface WorkspaceInput {
  periods: string[];
  facts: ExtractedFactLike[];
  overrides: OverrideLike[];
  scaleFactors?: number[];
  conflicts?: { canonicalKey: string; periodKey: string }[];
}

export interface WorkspaceView {
  periods: string[];
  cell(canonicalKey: string, periodKey: string): Cell;
  statement(kind: StatementKind): StatementRow[];
  findings: Finding[];
}

const id = (key: string, period: string) => `${key}::${period}`;

export function buildWorkspace(input: WorkspaceInput): WorkspaceView {
  const factIndex = new Map(input.facts.map((f) => [id(f.canonicalKey, f.periodKey), f]));
  const overrideIndex = new Map(input.overrides.map((o) => [id(o.canonicalKey, o.periodKey), o]));

  function cell(canonicalKey: string, periodKey: string): Cell {
    const fact = factIndex.get(id(canonicalKey, periodKey));
    const override = overrideIndex.get(id(canonicalKey, periodKey));
    const base: Omit<Cell, "value" | "source"> = {
      canonicalKey,
      periodKey,
      extractedValue: fact?.value,
      confidence: fact?.confidence,
      provenance: fact?.provenance,
    };
    if (override) return { ...base, value: override.value, source: "override" };
    if (fact) return { ...base, value: fact.value, source: "extracted" };
    return { ...base, value: undefined, source: "absent" };
  }

  const valueAt = (key: string, period: string) => cell(key, period).value;
  const confidenceAt = (key: string, period: string) => {
    const c = cell(key, period);
    // A figure the user has typed themselves is not low-confidence.
    return c.source === "override" ? undefined : c.confidence;
  };

  return {
    periods: input.periods,
    cell,
    statement(kind) {
      return itemsFor(kind).map((def) => ({
        def,
        cells: input.periods.map((p) => cell(def.key, p)),
      }));
    },
    findings: validate({
      periods: input.periods,
      valueAt,
      confidenceAt,
      scaleFactors: input.scaleFactors,
      conflicts: input.conflicts,
    }),
  };
}
```

- [ ] **Step 4: Write the purity guard test**

Create `src/model/purity.test.ts`:

```typescript
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
```

- [ ] **Step 5: Run both suites**

Run: `npm test -- model`
Expected: PASS. If the purity test fails, fix the import rather than the test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: workspace view layering overrides over immutable extracted facts"
```

---

### Task 7: Server actions — upload, extract, persist, override

**Files:**
- Create: `src/server/documents.ts`, `src/server/workspace.ts`, `src/app/actions.ts`
- Test: `src/server/documents.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6
- Produces:
  - `interface ActionResult<T> { ok: true; data: T } | { ok: false; code: string; message: string; remediation: string }`
  - `async function ingestAndExtract(deps, filename, bytes): Promise<ActionResult<{ workspaceId: string }>>`
  - `async function loadWorkspace(deps, workspaceId): Promise<WorkspaceView & { documentName: string; runId: string }>`
  - `async function setOverride(deps, workspaceId, key, period, value | null): Promise<void>`
  - Server actions in `src/app/actions.ts`: `uploadDocument(formData)`, `saveOverride(...)`, `clearOverride(...)`, `remapLineItem(...)`

Server actions **return** errors as `ActionResult`; they never throw across the boundary.

- [ ] **Step 1: Write the failing test**

Create `src/server/documents.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { migrate } from "@/db/client";
import { ingestAndExtract, loadWorkspace, setOverride } from "./documents";

function deps(call: ReturnType<typeof vi.fn>) {
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- documents`
Expected: FAIL — cannot resolve `./documents`.

- [ ] **Step 3: Write the server module**

Create `src/server/documents.ts`:

```typescript
import path from "node:path";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { ingest, IngestError } from "@/ingest";
import { extractDocument, type ClaudeCaller } from "@/extract/extract";
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

    deps.db.update(schema.extractionRuns)
      .set({ status: "complete", tokensIn: output.usage.tokensIn, tokensOut: output.usage.tokensOut })
      .where(eq(schema.extractionRuns.id, runId)).run();

    const workspaceId = deps.newId();
    deps.db.insert(schema.workspaces).values({
      id: workspaceId, name: filename, activeRunId: runId, createdAt: deps.now(),
    }).run();

    return { ok: true, data: { workspaceId } };
  } catch (error) {
    const message = (error as Error).message;
    const code = (error as { code?: string }).code ?? "extraction_failed";
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- documents`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the real dependencies into server actions**

Create `src/server/deps.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getDb } from "@/db/client";
import { callClaude } from "@/extract/client";
import type { Deps } from "./documents";

export function realDeps(): Deps {
  const dataDir = process.env.DATA_DIR ?? "./data";
  return {
    db: getDb(),
    call: callClaude,
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    dataDir,
    writeFile: async (filePath, bytes) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, bytes);
    },
  };
}
```

Create `src/app/actions.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { realDeps } from "@/server/deps";
import { ingestAndExtract, setOverride, type ActionResult } from "@/server/documents";

export async function uploadDocument(formData: FormData): Promise<ActionResult<{ workspaceId: string }>> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, code: "no_file", message: "No file was received.", remediation: "Pick a file and try again." };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await ingestAndExtract(realDeps(), file.name, bytes);
  if (result.ok) revalidatePath(`/w/${result.data.workspaceId}`);
  return result;
}

export async function saveOverride(
  workspaceId: string, canonicalKey: string, periodKey: string, value: number,
): Promise<ActionResult<null>> {
  if (!Number.isFinite(value)) {
    return { ok: false, code: "bad_number", message: `"${value}" is not a number.`, remediation: "Enter a plain number. Use a minus sign for negatives." };
  }
  await setOverride(realDeps(), workspaceId, canonicalKey, periodKey, value);
  revalidatePath(`/w/${workspaceId}`);
  return { ok: true, data: null };
}

export async function clearOverride(
  workspaceId: string, canonicalKey: string, periodKey: string,
): Promise<ActionResult<null>> {
  await setOverride(realDeps(), workspaceId, canonicalKey, periodKey, null);
  revalidatePath(`/w/${workspaceId}`);
  return { ok: true, data: null };
}
```

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat: server actions for upload, extraction, persistence and overrides"
```

---

### Task 8: Tooltip registry

**Files:**
- Create: `src/ui/tooltips.ts`, `src/ui/Tooltip.tsx`
- Test: `src/ui/tooltips.test.ts`

**Interfaces:**
- Consumes: `TAXONOMY` (Task 1), `FindingCode` (Task 5)
- Produces:
  - `function tooltip(key: string): string` — throws on an unknown key so a missing tooltip fails loudly in dev
  - `const TOOLTIPS: Record<string, string>`
  - `<Tooltip label={string}>{children}</Tooltip>` — accessible, keyboard-focusable

- [ ] **Step 1: Write the failing completeness test**

Create `src/ui/tooltips.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { TOOLTIPS, tooltip } from "./tooltips";
import { TAXONOMY } from "@/model/taxonomy";

const FINDING_CODES = [
  "balance_sheet_imbalance", "cashflow_tie_out", "subtotal_mismatch", "missing_periods",
  "missing_statement", "low_confidence", "scale_inconsistent", "merge_conflict",
];

const CONTROLS = [
  "control.upload", "control.reset_cell", "control.remap", "control.provenance",
  "control.rerun_extraction", "control.dismiss_banner",
];

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
    const missing = CONTROLS.filter((c) => !TOOLTIPS[c]);
    expect(missing).toEqual([]);
  });

  it("has no empty entries", () => {
    const empty = Object.entries(TOOLTIPS).filter(([, v]) => v.trim().length === 0).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it("throws on an unknown key so gaps surface in development", () => {
    expect(() => tooltip("item.does_not_exist")).toThrow(/does_not_exist/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tooltips`
Expected: FAIL — cannot resolve `./tooltips`.

- [ ] **Step 3: Write the registry**

Create `src/ui/tooltips.ts`. Line-item entries are generated from the taxonomy definitions so the two can never drift.

```typescript
import { TAXONOMY } from "@/model/taxonomy";

const itemTooltips: Record<string, string> = Object.fromEntries(
  TAXONOMY.map((i) => [`item.${i.key}`, i.definition]),
);

const findingTooltips: Record<string, string> = {
  "finding.balance_sheet_imbalance":
    "Total assets must equal total liabilities plus shareholders' equity. When they don't, a line item was missed, double-counted, or scaled differently from the rest of the statement.",
  "finding.cashflow_tie_out":
    "Operating, investing and financing cash flows plus the FX effect must equal the net change in cash, and that net change must equal the movement in balance-sheet cash between periods.",
  "finding.subtotal_mismatch":
    "A printed subtotal disagrees with the sum of the components extracted under it. Often the source includes a line this taxonomy does not model, so check before correcting.",
  "finding.missing_periods":
    "No reporting periods were found. Either the document has no statements, or the period headers were not recognised.",
  "finding.missing_statement":
    "One of the three statements produced no figures. Ratios and forecasts that depend on it will be unavailable.",
  "finding.low_confidence":
    "The extractor reported low confidence on these figures. Check each against its source page before relying on it.",
  "finding.scale_inconsistent":
    "Figures in this document were scaled by more than one factor. Mixing thousands and millions is a common cause of silent, large errors.",
  "finding.merge_conflict":
    "The same line item and period were extracted twice with different values. The higher-confidence value is active until you choose.",
};

const controlTooltips: Record<string, string> = {
  "control.upload": "Drop a 10-K, 10-Q, case PDF or Excel workbook here, or click to pick a file. Limit 30 MB.",
  "control.reset_cell": "Discard your edit and restore the value as extracted from the source document.",
  "control.remap": "Move this line to a different canonical item. Use this when the extractor put a figure in the wrong bucket.",
  "control.provenance": "Show where this figure came from: source page, the label and value as printed, and the scale applied.",
  "control.rerun_extraction": "Extract this document again. The current results are kept until the new run succeeds.",
  "control.dismiss_banner": "Hide this message. It will return if the underlying problem is still present after your next edit.",
  "control.confidence_badge": "How confident the extractor was in this figure and its mapping. Below 60% is flagged for review.",
  "control.scale_badge": "The multiplier applied to the printed figure to reach base currency units.",
};

export const TOOLTIPS: Record<string, string> = {
  ...itemTooltips,
  ...findingTooltips,
  ...controlTooltips,
};

export function tooltip(key: string): string {
  const text = TOOLTIPS[key];
  if (!text) throw new Error(`No tooltip registered for "${key}". Add it to src/ui/tooltips.ts.`);
  return text;
}
```

- [ ] **Step 4: Write the Tooltip component**

Create `src/ui/Tooltip.tsx`:

```tsx
"use client";

import { useId, useState, type ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
}

/** Hover- and focus-triggered tooltip. Focusable so it is reachable by keyboard. */
export function Tooltip({ label, children }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded border border-slate-700 bg-slate-900 p-2 text-xs leading-relaxed text-slate-100 shadow-lg"
        >
          {label}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- tooltips`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: single-source tooltip registry with completeness test"
```

---

### Task 9: Upload screen with drag-and-drop and error banners

**Files:**
- Create: `src/app/page.tsx` (replace scaffold), `src/ui/DropZone.tsx`, `src/ui/Banner.tsx`, `src/ui/Toast.tsx`, `src/ui/ToastProvider.tsx`
- Modify: `src/app/layout.tsx` — wrap children in `ToastProvider`
- Test: `src/ui/Banner.test.tsx`

**Interfaces:**
- Consumes: `uploadDocument` (Task 7), `tooltip` (Task 8)
- Produces:
  - `<DropZone onFile={(file: File) => void} busy={boolean} />` — drop target plus a real `<input type="file">` fallback
  - `<Banner severity="blocking" | "warning" title message remediation onAction? actionLabel? onDismiss? />`
  - `useToast(): { show(message: string, opts?: { undo?: () => void }): void }`

- [ ] **Step 1: Write the failing Banner test**

Create `src/ui/Banner.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Banner } from "./Banner";

describe("Banner", () => {
  it("renders the message and its remediation", () => {
    render(<Banner severity="blocking" title="Balance sheet does not balance" message="Gap 400." remediation="Check the three totals." />);
    expect(screen.getByText(/Gap 400/)).toBeTruthy();
    expect(screen.getByText(/Check the three totals/)).toBeTruthy();
  });

  it("marks blocking banners as alerts for screen readers", () => {
    render(<Banner severity="blocking" title="t" message="m" remediation="r" />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("uses status rather than alert for warnings", () => {
    render(<Banner severity="warning" title="t" message="m" remediation="r" />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("fires the action handler", () => {
    const onAction = vi.fn();
    render(<Banner severity="blocking" title="t" message="m" remediation="r" actionLabel="Fix it" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Fix it" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("renders no dismiss control when no handler is given", () => {
    render(<Banner severity="blocking" title="t" message="m" remediation="r" />);
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });
});
```

Add `@testing-library/react`, `@testing-library/dom` and `jsdom` as dev dependencies, and set `environment: "jsdom"` for `*.test.tsx` via a `environmentMatchGlobs` entry in `vitest.config.ts`:

```typescript
test: {
  environment: "node",
  environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
  include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
},
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- Banner`
Expected: FAIL — cannot resolve `./Banner`.

- [ ] **Step 3: Write Banner**

Create `src/ui/Banner.tsx`:

```tsx
"use client";

interface Props {
  severity: "blocking" | "warning";
  title: string;
  message: string;
  remediation: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}

export function Banner({ severity, title, message, remediation, actionLabel, onAction, onDismiss }: Props) {
  const blocking = severity === "blocking";
  return (
    <div
      role={blocking ? "alert" : "status"}
      className={[
        "flex flex-col gap-1 rounded border px-4 py-3 text-sm",
        blocking
          ? "border-rose-800 bg-rose-950/40 text-rose-100"
          : "border-amber-800 bg-amber-950/30 text-amber-100",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-0.5 opacity-90">{message}</p>
          <p className="mt-1 text-xs opacity-75">{remediation}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="rounded border border-current px-2 py-1 text-xs font-medium"
            >
              {actionLabel}
            </button>
          )}
          {onDismiss && (
            <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-xs opacity-70">
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify Banner passes**

Run: `npm test -- Banner`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the toast system**

Create `src/ui/ToastProvider.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  undo?: () => void;
}

interface ToastApi {
  show(message: string, opts?: { undo?: () => void }): void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useToast must be used inside ToastProvider");
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback<ToastApi["show"]>((message, opts) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, undo: opts?.undo }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), opts?.undo ? 8000 : 4000);
  }, []);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-center gap-3 whitespace-nowrap rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 shadow-lg"
          >
            <span>{t.message}</span>
            {t.undo && (
              <button
                type="button"
                className="text-xs font-medium underline"
                onClick={() => {
                  t.undo?.();
                  setItems((prev) => prev.filter((x) => x.id !== t.id));
                }}
              >
                Undo
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
```

- [ ] **Step 6: Write DropZone and the upload page**

Create `src/ui/DropZone.tsx`:

```tsx
"use client";

import { useRef, useState, type DragEvent } from "react";
import { Tooltip } from "./Tooltip";
import { tooltip } from "./tooltips";

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
}

export function DropZone({ onFile, busy }: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      className={[
        "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-12 text-center transition-colors",
        over ? "border-sky-500 bg-sky-950/20" : "border-slate-700",
        busy ? "opacity-60" : "",
      ].join(" ")}
    >
      <Tooltip label={tooltip("control.upload")}>
        <p className="text-sm text-slate-300">
          Drop a 10-K, 10-Q, case PDF or Excel workbook here
        </p>
      </Tooltip>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-50"
      >
        {busy ? "Extracting…" : "Choose a file"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.xlsx,.xls,.xlsm"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
```

Create `src/app/page.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DropZone } from "@/ui/DropZone";
import { Banner } from "@/ui/Banner";
import { useToast } from "@/ui/ToastProvider";
import { uploadDocument } from "./actions";

export default function Home() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ title: string; message: string; remediation: string } | null>(null);
  const router = useRouter();
  const toast = useToast();

  function handleFile(file: File) {
    setError(null);
    const form = new FormData();
    form.set("file", file);
    startTransition(async () => {
      const result = await uploadDocument(form);
      if (!result.ok) {
        setError({ title: "That upload did not work", message: result.message, remediation: result.remediation });
        return;
      }
      toast.show(`Extracted ${file.name}`);
      router.push(`/w/${result.data.workspaceId}`);
    });
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-10">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Financial statements</h1>
        <p className="mt-1 text-sm text-slate-400">
          Upload a filing or workbook. Every extracted figure keeps a link back to the page it came from.
        </p>
      </div>
      {error && (
        <Banner
          severity="blocking"
          title={error.title}
          message={error.message}
          remediation={error.remediation}
          onDismiss={() => setError(null)}
        />
      )}
      <DropZone onFile={handleFile} busy={pending} />
    </main>
  );
}
```

Modify `src/app/layout.tsx` to wrap `{children}` in `<ToastProvider>`.

- [ ] **Step 7: Run the app and upload a real document**

Run: `npm run dev`, open `http://localhost:3000`, drop a real 10-K PDF.
Expected: extraction runs, the browser navigates to `/w/<id>`. (That route arrives in Task 10 — a 404 here is correct, and the toast plus the created rows in `data/finmodel.db` confirm the pipeline worked.)

- [ ] **Step 8: Commit**

```bash
npx tsc --noEmit
npm test
git add -A
git commit -m "feat: upload screen with drag-drop, error banners and toasts"
```

---

### Task 10: Statement grid with editable cells and provenance panel

**Files:**
- Create: `src/app/w/[id]/page.tsx`, `src/ui/StatementTable.tsx`, `src/ui/EditableCell.tsx`, `src/ui/ProvenancePanel.tsx`, `src/ui/format.ts`
- Test: `src/ui/format.test.ts`, `src/ui/EditableCell.test.tsx`

**Interfaces:**
- Consumes: `loadWorkspace` (Task 7), `Cell` / `StatementRow` (Task 6), `Finding` (Task 5), tooltips (Task 8)
- Produces:
  - `function formatMoney(value: number | undefined): string` — thousands separators, parentheses for negatives, em dash for absent
  - `function parseMoney(input: string): number | null` — accepts `1,234`, `(500)`, `-500`, `1.2`; returns `null` for anything else
  - `<StatementTable rows={StatementRow[]} periods={string[]} onEdit onReset onInspect />`
  - `<ProvenancePanel cell={Cell} documentName={string} onClose />`

- [ ] **Step 1: Write the failing format test**

Create `src/ui/format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatMoney, parseMoney } from "./format";

describe("formatMoney", () => {
  it("groups thousands", () => expect(formatMoney(1234567)).toBe("1,234,567"));
  it("wraps negatives in parentheses", () => expect(formatMoney(-500)).toBe("(500)"));
  it("renders an absent value as an em dash", () => expect(formatMoney(undefined)).toBe("—"));
  it("renders zero as zero, not a dash", () => expect(formatMoney(0)).toBe("0"));
});

describe("parseMoney", () => {
  it("accepts grouped digits", () => expect(parseMoney("1,234")).toBe(1234));
  it("accepts parenthesised negatives", () => expect(parseMoney("(500)")).toBe(-500));
  it("accepts a leading minus", () => expect(parseMoney("-500")).toBe(-500));
  it("accepts decimals", () => expect(parseMoney("1.5")).toBe(1.5));
  it("accepts a currency symbol", () => expect(parseMoney("$1,000")).toBe(1000));
  it("rejects letters", () => expect(parseMoney("about 500")).toBeNull());
  it("rejects an empty string", () => expect(parseMoney("  ")).toBeNull());
  it("rejects two minus signs", () => expect(parseMoney("--5")).toBeNull());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- format`
Expected: FAIL — cannot resolve `./format`.

- [ ] **Step 3: Write the formatters**

Create `src/ui/format.ts`:

```typescript
export function formatMoney(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return value < 0 ? `(${abs})` : abs;
}

export function parseMoney(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const parenthesised = /^\((.*)\)$/.exec(trimmed);
  const body = parenthesised ? parenthesised[1] : trimmed;
  const cleaned = body.replace(/[$£€\s,]/g, "");

  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return parenthesised ? -Math.abs(n) : n;
}
```

- [ ] **Step 4: Run to verify formats pass**

Run: `npm test -- format`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the editable cell and its test**

Create `src/ui/EditableCell.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { Cell } from "@/model/workspace";
import { formatMoney, parseMoney } from "./format";

interface Props {
  cell: Cell;
  onCommit: (value: number) => void;
  onReset: () => void;
  onInspect: () => void;
}

export function EditableCell({ cell, onCommit, onReset, onInspect }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  function commit() {
    const parsed = parseMoney(draft);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setEditing(false);
    onCommit(parsed);
  }

  if (editing) {
    return (
      <td className="px-2 py-1 text-right">
        <input
          autoFocus
          aria-label={`Edit ${cell.canonicalKey} ${cell.periodKey}`}
          aria-invalid={invalid}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setEditing(false); setInvalid(false); }
          }}
          className={[
            "w-28 rounded border bg-slate-900 px-1 py-0.5 text-right text-sm",
            invalid ? "border-rose-500" : "border-slate-600",
          ].join(" ")}
        />
        {invalid && <p className="mt-0.5 text-right text-[11px] text-rose-400">Enter a plain number</p>}
      </td>
    );
  }

  const lowConfidence = cell.source === "extracted" && cell.confidence !== undefined && cell.confidence < 0.6;

  return (
    <td className="px-2 py-1 text-right">
      <span className="inline-flex items-center justify-end gap-1">
        {lowConfidence && <span title="Low extraction confidence" className="text-amber-400">!</span>}
        <button
          type="button"
          onDoubleClick={() => { setDraft(cell.value === undefined ? "" : String(cell.value)); setEditing(true); }}
          onClick={onInspect}
          className={[
            "tabular-nums",
            cell.source === "override" ? "text-sky-300 underline decoration-dotted" : "text-slate-200",
          ].join(" ")}
        >
          {formatMoney(cell.value)}
        </button>
        {cell.source === "override" && (
          <button type="button" onClick={onReset} aria-label="Reset to extracted value" className="text-[11px] text-slate-500">
            ↺
          </button>
        )}
      </span>
    </td>
  );
}
```

Create `src/ui/EditableCell.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditableCell } from "./EditableCell";
import type { Cell } from "@/model/workspace";

function cell(over: Partial<Cell> = {}): Cell {
  return {
    canonicalKey: "revenue", periodKey: "FY2024", value: 1000, source: "extracted",
    extractedValue: 1000, confidence: 0.9, provenance: undefined, ...over,
  };
}

function renderCell(props: Partial<Parameters<typeof EditableCell>[0]> = {}) {
  const onCommit = vi.fn();
  const onReset = vi.fn();
  const onInspect = vi.fn();
  render(
    <table><tbody><tr>
      <EditableCell cell={cell()} onCommit={onCommit} onReset={onReset} onInspect={onInspect} {...props} />
    </tr></tbody></table>,
  );
  return { onCommit, onReset, onInspect };
}

describe("EditableCell", () => {
  it("shows a formatted value", () => {
    renderCell();
    expect(screen.getByText("1,000")).toBeTruthy();
  });

  it("opens an editor on double click and commits a parsed value", () => {
    const { onCommit } = renderCell();
    fireEvent.doubleClick(screen.getByText("1,000"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "(2,500)" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(-2500);
  });

  it("refuses to commit an unparseable value and marks the field invalid", () => {
    const { onCommit } = renderCell();
    fireEvent.doubleClick(screen.getByText("1,000"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "roughly 900" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
  });

  it("discards the edit on Escape", () => {
    const { onCommit } = renderCell();
    fireEvent.doubleClick(screen.getByText("1,000"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("offers a reset control only for overridden cells", () => {
    renderCell();
    expect(screen.queryByLabelText("Reset to extracted value")).toBeNull();
  });

  it("flags a low-confidence extracted cell", () => {
    renderCell({ cell: cell({ confidence: 0.2 }) });
    expect(screen.getByTitle("Low extraction confidence")).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run the cell tests**

Run: `npm test -- EditableCell`
Expected: PASS, 6 tests.

- [ ] **Step 7: Write the provenance panel**

Create `src/ui/ProvenancePanel.tsx`:

```tsx
"use client";

import type { Cell } from "@/model/workspace";
import { lineItem } from "@/model/taxonomy";
import { formatMoney } from "./format";
import { tooltip } from "./tooltips";
import { Tooltip } from "./Tooltip";

interface Props {
  cell: Cell;
  documentName: string;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-800 py-1.5 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-right text-slate-100">{value}</span>
    </div>
  );
}

export function ProvenancePanel({ cell, documentName, onClose }: Props) {
  const def = lineItem(cell.canonicalKey);
  const p = cell.provenance;

  return (
    <aside className="fixed right-0 top-0 z-40 h-full w-96 overflow-y-auto border-l border-slate-800 bg-slate-950 p-5">
      <div className="flex items-start justify-between">
        <div>
          <Tooltip label={def ? tooltip(`item.${def.key}`) : "Unknown line item"}>
            <h2 className="text-base font-medium text-slate-100">{def?.label ?? cell.canonicalKey}</h2>
          </Tooltip>
          <p className="text-xs text-slate-500">{cell.periodKey}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500">×</button>
      </div>

      {!p ? (
        <p className="mt-6 text-sm text-slate-400">
          {cell.source === "override"
            ? "You entered this value. It was not present in the source document, so there is nothing to trace."
            : "No figure was extracted for this line and period."}
        </p>
      ) : (
        <div className="mt-5">
          <Row label="Document" value={documentName} />
          <Row label={p.page !== null ? "Page" : "Sheet"} value={p.page !== null ? String(p.page) : (p.sheet ?? "—")} />
          <Row label="Position" value={p.locator || "—"} />
          <Row label="Label as printed" value={p.rawLabel} />
          <Row label="Value as printed" value={p.rawValue} />
          <Row label="Scale applied" value={p.scaleFactor === 1 ? "none (stated in units)" : `× ${p.scaleFactor.toLocaleString("en-US")}`} />
          <Row label="Scale evidence" value={p.scaleEvidence || "not stated in the document"} />
          <Row label="Shown in parentheses" value={p.signFlipped ? "yes — treated as negative" : "no"} />
          <Row label="Extracted value" value={formatMoney(cell.extractedValue)} />
          <Row label="Confidence" value={cell.confidence === undefined ? "—" : `${Math.round(cell.confidence * 100)}%`} />
          {cell.source === "override" && <Row label="Your value" value={formatMoney(cell.value)} />}
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 8: Write the statement table and the workspace page**

Create `src/ui/StatementTable.tsx`:

```tsx
"use client";

import type { StatementRow, Cell } from "@/model/workspace";
import { EditableCell } from "./EditableCell";
import { Tooltip } from "./Tooltip";
import { tooltip } from "./tooltips";

interface Props {
  title: string;
  rows: StatementRow[];
  periods: string[];
  onEdit: (key: string, period: string, value: number) => void;
  onReset: (key: string, period: string) => void;
  onInspect: (cell: Cell) => void;
}

export function StatementTable({ title, rows, periods, onEdit, onReset, onInspect }: Props) {
  const populated = rows.filter((r) => r.cells.some((c) => c.value !== undefined));
  if (populated.length === 0) return null;

  return (
    <section className="overflow-x-auto">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-400">{title}</h2>
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="px-2 py-1 text-left font-medium text-slate-400">Line item</th>
            {periods.map((p) => (
              <th key={p} className="px-2 py-1 text-right font-medium text-slate-400">{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {populated.map((row) => (
            <tr key={row.def.key} className={row.def.isSubtotal ? "border-t border-slate-800 font-medium" : ""}>
              <td className="px-2 py-1 text-left">
                <Tooltip label={tooltip(`item.${row.def.key}`)}>
                  <span className={row.def.parentKey ? "pl-4 text-slate-300" : "text-slate-200"}>{row.def.label}</span>
                </Tooltip>
              </td>
              {row.cells.map((cell) => (
                <EditableCell
                  key={cell.periodKey}
                  cell={cell}
                  onCommit={(v) => onEdit(cell.canonicalKey, cell.periodKey, v)}
                  onReset={() => onReset(cell.canonicalKey, cell.periodKey)}
                  onInspect={() => onInspect(cell)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

Create `src/app/w/[id]/page.tsx` as a server component that loads the workspace and hands a serialisable snapshot to a client component:

```tsx
import { realDeps } from "@/server/deps";
import { loadWorkspace } from "@/server/documents";
import { WorkspaceScreen } from "./WorkspaceScreen";

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await loadWorkspace(realDeps(), id);

  return (
    <WorkspaceScreen
      workspaceId={id}
      documentName={ws.documentName}
      periods={ws.periods}
      findings={ws.findings}
      statements={{
        income: ws.statement("income"),
        balance: ws.statement("balance"),
        cashflow: ws.statement("cashflow"),
      }}
    />
  );
}
```

Create `src/app/w/[id]/WorkspaceScreen.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StatementRow, Cell } from "@/model/workspace";
import type { Finding } from "@/model/validate";
import { StatementTable } from "@/ui/StatementTable";
import { ProvenancePanel } from "@/ui/ProvenancePanel";
import { Banner } from "@/ui/Banner";
import { useToast } from "@/ui/ToastProvider";
import { tooltip } from "@/ui/tooltips";
import { saveOverride, clearOverride } from "@/app/actions";

interface Props {
  workspaceId: string;
  documentName: string;
  periods: string[];
  findings: Finding[];
  statements: { income: StatementRow[]; balance: StatementRow[]; cashflow: StatementRow[] };
}

export function WorkspaceScreen({ workspaceId, documentName, periods, findings, statements }: Props) {
  const [inspected, setInspected] = useState<Cell | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function edit(key: string, period: string, value: number, previous: number | undefined, wasOverride: boolean) {
    startTransition(async () => {
      const result = await saveOverride(workspaceId, key, period, value);
      if (!result.ok) {
        toast.show(result.message);
        return;
      }
      router.refresh();
      toast.show("Value updated", {
        undo: () => startTransition(async () => {
          if (wasOverride && previous !== undefined) await saveOverride(workspaceId, key, period, previous);
          else await clearOverride(workspaceId, key, period);
          router.refresh();
        }),
      });
    });
  }

  function reset(key: string, period: string) {
    startTransition(async () => {
      await clearOverride(workspaceId, key, period);
      router.refresh();
      toast.show("Restored the extracted value");
    });
  }

  const visible = findings.filter((f) => !dismissed.has(`${f.code}:${f.periodKey}`));

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-8">
      <header>
        <h1 className="text-lg font-semibold text-slate-100">{documentName}</h1>
        <p className="text-xs text-slate-500">
          {periods.length} period{periods.length === 1 ? "" : "s"} · double-click any figure to edit it, single-click to see where it came from
        </p>
      </header>

      {visible.length > 0 && (
        <div className="flex flex-col gap-2">
          {visible.map((f) => (
            <Banner
              key={`${f.code}:${f.periodKey}:${f.keys.join(",")}`}
              severity={f.severity}
              title={tooltip(`finding.${f.code}`)}
              message={f.message}
              remediation={f.remediation}
              onDismiss={f.severity === "warning"
                ? () => setDismissed((prev) => new Set(prev).add(`${f.code}:${f.periodKey}`))
                : undefined}
            />
          ))}
        </div>
      )}

      <StatementTable title="Income statement" rows={statements.income} periods={periods}
        onEdit={(k, p, v) => edit(k, p, v, findCell(statements.income, k, p)?.value, findCell(statements.income, k, p)?.source === "override")}
        onReset={reset} onInspect={setInspected} />
      <StatementTable title="Balance sheet" rows={statements.balance} periods={periods}
        onEdit={(k, p, v) => edit(k, p, v, findCell(statements.balance, k, p)?.value, findCell(statements.balance, k, p)?.source === "override")}
        onReset={reset} onInspect={setInspected} />
      <StatementTable title="Cash flow" rows={statements.cashflow} periods={periods}
        onEdit={(k, p, v) => edit(k, p, v, findCell(statements.cashflow, k, p)?.value, findCell(statements.cashflow, k, p)?.source === "override")}
        onReset={reset} onInspect={setInspected} />

      {inspected && (
        <ProvenancePanel cell={inspected} documentName={documentName} onClose={() => setInspected(null)} />
      )}
    </main>
  );
}

function findCell(rows: StatementRow[], key: string, period: string): Cell | undefined {
  return rows.find((r) => r.def.key === key)?.cells.find((c) => c.periodKey === period);
}
```

- [ ] **Step 9: Run everything and walk the app**

```bash
npx tsc --noEmit
npm test
npm run dev
```

Upload a real 10-K. Confirm: statements render, a figure opens the provenance panel with the correct page, a double-click edit saves and survives a browser refresh, the reset arrow restores the extracted value, and any reconciliation banner names a real period.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: statement grid with editable cells, provenance panel and reconciliation banners"
```

---

### Task 11: Drag-to-remap misclassified line items

**Files:**
- Create: `src/server/remap.ts`, `src/ui/RemapDrawer.tsx`
- Modify: `src/app/actions.ts` — add `remapLineItem`
- Modify: `src/app/w/[id]/WorkspaceScreen.tsx` — mount the drawer and DnD context
- Modify: `src/server/documents.ts` — `loadWorkspace` also returns `unmapped` facts
- Test: `src/server/remap.test.ts`

**Interfaces:**
- Consumes: `Deps` (Task 7), taxonomy (Task 1)
- Produces:
  - `async function remapFact(deps, runId, factId, toCanonicalKey): Promise<void>` — rewrites the fact's canonical key, preserving provenance
  - `remapLineItem(workspaceId, factId, toKey)` server action
  - `<RemapDrawer facts={UnmappedFact[]} onRemap={(factId, key) => void} />` — draggable chips **plus** a select-based fallback for every chip

- [ ] **Step 1: Write the failing test**

Create `src/server/remap.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { migrate } from "@/db/client";
import { remapFact } from "./remap";

function setup() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db);
  db.insert(schema.documents).values({
    id: "d", filename: "a.pdf", kind: "pdf", hash: "h", sizeBytes: 1, storagePath: "/tmp/a", ingestedAt: 1,
  }).run();
  db.insert(schema.extractionRuns).values({
    id: "r", documentId: "d", modelId: "claude-opus-5", promptVersion: 1, status: "complete", createdAt: 1,
  }).run();
  db.insert(schema.facts).values({
    id: "f", runId: "r", canonicalKey: "unmapped", periodKey: "FY2024", value: 42, confidence: 0.5,
    provenance: { page: 7, sheet: null, locator: "row 9", rawLabel: "Deferred revenue",
                  rawValue: "42", scaleFactor: 1, scaleEvidence: "", signFlipped: false },
  }).run();
  return { db, call: vi.fn(), now: () => 2, newId: () => "n", writeFile: async () => {}, dataDir: "/tmp" };
}

describe("remapFact", () => {
  it("moves a fact to a new canonical key and keeps its provenance", async () => {
    const deps = setup();
    await remapFact(deps, "f", "deferred_revenue_current");
    const [fact] = deps.db.select().from(schema.facts).all();
    expect(fact.canonicalKey).toBe("deferred_revenue_current");
    expect(fact.provenance.rawLabel).toBe("Deferred revenue");
    expect(fact.provenance.page).toBe(7);
  });

  it("refuses a key that is not in the taxonomy", async () => {
    const deps = setup();
    await expect(remapFact(deps, "f", "invented_key")).rejects.toThrow(/invented_key/);
  });

  it("refuses when the target key and period already hold a fact", async () => {
    const deps = setup();
    deps.db.insert(schema.facts).values({
      id: "f2", runId: "r", canonicalKey: "inventory", periodKey: "FY2024", value: 1, confidence: 1,
      provenance: { page: 1, sheet: null, locator: "", rawLabel: "Inventory", rawValue: "1",
                    scaleFactor: 1, scaleEvidence: "", signFlipped: false },
    }).run();
    await expect(remapFact(deps, "f", "inventory")).rejects.toThrow(/already/i);
  });

  it("refuses an unknown fact id", async () => {
    const deps = setup();
    await expect(remapFact(deps, "nope", "inventory")).rejects.toThrow(/nope/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- remap`
Expected: FAIL — cannot resolve `./remap`.

- [ ] **Step 3: Write the remapper**

Create `src/server/remap.ts`:

```typescript
import { and, eq, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import { lineItem } from "@/model/taxonomy";
import type { Deps } from "./documents";

export async function remapFact(deps: Deps, factId: string, toCanonicalKey: string): Promise<void> {
  if (!lineItem(toCanonicalKey)) {
    throw new Error(`"${toCanonicalKey}" is not a canonical line item.`);
  }

  const [fact] = deps.db.select().from(schema.facts).where(eq(schema.facts.id, factId)).all();
  if (!fact) throw new Error(`No fact "${factId}".`);

  const clash = deps.db.select().from(schema.facts).where(and(
    eq(schema.facts.runId, fact.runId),
    eq(schema.facts.canonicalKey, toCanonicalKey),
    eq(schema.facts.periodKey, fact.periodKey),
    ne(schema.facts.id, factId),
  )).all();

  if (clash.length > 0) {
    const label = lineItem(toCanonicalKey)?.label ?? toCanonicalKey;
    throw new Error(`${label} already has a value for ${fact.periodKey}. Clear it before moving this line there.`);
  }

  deps.db.update(schema.facts)
    .set({ canonicalKey: toCanonicalKey })
    .where(eq(schema.facts.id, factId))
    .run();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- remap`
Expected: PASS, 4 tests.

- [ ] **Step 5: Persist unmapped figures so there is something to remap**

Modify `src/extract/merge.ts` so unmapped figures become facts with `canonicalKey: "unmapped"` rather than being dropped, and keep reporting their labels:

```typescript
    const known = lineItem(figure.canonical_key);
    if (!known || figure.canonical_key === UNMAPPED_KEY) {
      unmappedLabels.push(figure.raw_label);
      // Keep the figure so the user can drag it to the right bucket.
      const list = buckets.get(`${UNMAPPED_KEY}::${figure.raw_label}::${figure.period_key}`) ?? [];
      list.push({ ...toFact(figure), canonicalKey: UNMAPPED_KEY });
      buckets.set(`${UNMAPPED_KEY}::${figure.raw_label}::${figure.period_key}`, list);
      continue;
    }
```

Update `mergeFigures`' conflict detection to skip buckets whose id starts with `unmapped::` — two different unmapped labels are not a conflict. Update `src/extract/merge.test.ts`: the two `unmapped` tests now assert `out.facts` has one fact with `canonicalKey === "unmapped"`, and `unmappedLabels` still contains the label. Run `npm test -- merge` and confirm all pass.

Modify `loadWorkspace` in `src/server/documents.ts` to filter `unmapped` facts out of the workspace facts and return them separately:

```typescript
  const mapped = factRows.filter((f) => f.canonicalKey !== "unmapped");
  const unmapped = factRows.filter((f) => f.canonicalKey === "unmapped").map((f) => ({
    id: f.id, periodKey: f.periodKey, value: f.value, label: f.provenance.rawLabel,
    page: f.provenance.page, rawValue: f.provenance.rawValue,
  }));
```

Pass `mapped` to `buildWorkspace` and return `unmapped` alongside the view. Update `src/server/documents.test.ts`'s first test to assert both mapped and unmapped facts land in the table.

- [ ] **Step 6: Add the remap action**

Append to `src/app/actions.ts`:

```typescript
import { remapFact } from "@/server/remap";

export async function remapLineItem(
  workspaceId: string, factId: string, toCanonicalKey: string,
): Promise<ActionResult<null>> {
  try {
    await remapFact(realDeps(), factId, toCanonicalKey);
    revalidatePath(`/w/${workspaceId}`);
    return { ok: true, data: null };
  } catch (error) {
    return {
      ok: false, code: "remap_failed", message: (error as Error).message,
      remediation: "Pick a different target line, or clear the existing value there first.",
    };
  }
}
```

- [ ] **Step 7: Write the remap drawer**

Create `src/ui/RemapDrawer.tsx`. Every chip carries a `<select>` fallback so remapping works without a pointer.

```tsx
"use client";

import { useDraggable } from "@dnd-kit/core";
import { TAXONOMY } from "@/model/taxonomy";
import { formatMoney } from "./format";
import { Tooltip } from "./Tooltip";
import { tooltip } from "./tooltips";

export interface UnmappedFact {
  id: string;
  label: string;
  periodKey: string;
  value: number;
  page: number | null;
  rawValue: string;
}

function Chip({ fact, onRemap }: { fact: UnmappedFact; onRemap: (factId: string, key: string) => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: fact.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900 px-2 py-1.5">
      <span {...listeners} {...attributes} className="cursor-grab text-xs text-slate-500" aria-hidden>⠿</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-200">{fact.label}</p>
        <p className="text-[11px] text-slate-500">
          {fact.periodKey} · {formatMoney(fact.value)}{fact.page !== null ? ` · p.${fact.page}` : ""}
        </p>
      </div>
      <select
        aria-label={`Move ${fact.label} to a line item`}
        defaultValue=""
        onChange={(e) => { if (e.target.value) onRemap(fact.id, e.target.value); }}
        className="max-w-[10rem] rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-xs text-slate-300"
      >
        <option value="" disabled>Move to…</option>
        {TAXONOMY.map((i) => (
          <option key={i.key} value={i.key}>{i.label}</option>
        ))}
      </select>
    </div>
  );
}

export function RemapDrawer({ facts, onRemap }: { facts: UnmappedFact[]; onRemap: (factId: string, key: string) => void }) {
  if (facts.length === 0) return null;

  return (
    <section className="rounded border border-amber-900 bg-amber-950/20 p-4">
      <Tooltip label={tooltip("control.remap")}>
        <h2 className="mb-2 text-sm font-medium text-amber-200">
          {facts.length} figure{facts.length === 1 ? "" : "s"} could not be mapped
        </h2>
      </Tooltip>
      <p className="mb-3 text-xs text-amber-200/70">
        Drag one onto the right line in a statement below, or use its dropdown. Until then these are excluded from every total.
      </p>
      <div className="flex flex-col gap-2">
        {facts.map((f) => <Chip key={f.id} fact={f} onRemap={onRemap} />)}
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Wire drag targets into the statement rows**

In `src/ui/StatementTable.tsx`, make each row's label cell a droppable target:

```tsx
import { useDroppable } from "@dnd-kit/core";

function LabelCell({ rowKey, children }: { rowKey: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `row:${rowKey}` });
  return (
    <td ref={setNodeRef} className={["px-2 py-1 text-left", isOver ? "bg-sky-950/40 outline outline-1 outline-sky-600" : ""].join(" ")}>
      {children}
    </td>
  );
}
```

Replace the existing `<td className="px-2 py-1 text-left">` in the row body with `<LabelCell rowKey={row.def.key}>`.

In `WorkspaceScreen.tsx`, wrap the page in `<DndContext onDragEnd={...}>` from `@dnd-kit/core`, mount `<RemapDrawer>` above the tables, and handle the drop:

```tsx
  function handleDragEnd(event: DragEndEvent) {
    const targetId = String(event.over?.id ?? "");
    if (!targetId.startsWith("row:")) return;
    const toKey = targetId.slice(4);
    const factId = String(event.active.id);
    startTransition(async () => {
      const result = await remapLineItem(workspaceId, factId, toKey);
      if (!result.ok) {
        toast.show(result.message);
        return;
      }
      router.refresh();
      toast.show("Line item moved");
    });
  }
```

- [ ] **Step 9: Full verification**

```bash
npx tsc --noEmit
npm test
npm run dev
```

In the browser: upload a document that produces at least one unmapped figure, drag its chip onto a statement row, confirm the value lands in that row and the drawer shrinks. Then repeat using only the keyboard and the dropdown. Refresh the page and confirm the remap persisted. Confirm a remap onto an occupied line shows the "already has a value" toast rather than silently overwriting.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: drag-to-remap unmapped line items with keyboard fallback"
```

---

## Spec Coverage Check

| Spec section | Covered by |
|---|---|
| §4.1 Ingest, all failure modes | Task 3 |
| §4.2 Extract, provenance fields, chunking, merge conflicts, run recording | Tasks 4, 7 |
| §4.2 Validation gate, five checks | Task 5 |
| §4.3 Model, override layering, immutable facts | Task 6 (dependency graph and forecasting are M3) |
| §5 Data model | Task 2 |
| §6 Provenance display | Task 10 (page-image rendering deferred to M2 — text provenance ships first) |
| §7 Interpretation | M2 |
| §8.1 Blocking banners | Tasks 5, 9, 10 |
| §8.2 Inline warnings | Task 10 (low confidence, invalid input) |
| §8.3 Toasts with undo | Tasks 9, 10 |
| §9 File drop | Task 9 |
| §9 Line-item remap, with non-drag equivalent | Task 11 |
| §9 Ratio builder, report layout | M2, M4 |
| §10 Tooltip registry with completeness test | Task 8 |
| §12 Testing strategy | Every task; Playwright coverage lands in M5 |

Two deliberate deferrals inside M1's scope: rendering the source page region in the provenance panel (text provenance ships now, the page crop needs a PDF renderer and belongs with M2's chart work), and golden-file extraction fixtures against a committed real filing (needs a redistributable filing chosen first — raise with the user before M2).
