# rolemodel

A local-first financial modelling webapp. Drop in a 10-K, a 10-Q, or an Excel workbook,
and it extracts the income statement, balance sheet and cash-flow statement into a
canonical model you can edit, reconcile, and build on.

Two properties drive the whole design:

- **Every extracted number is traceable.** Click any figure and see the source document,
  page or sheet, the literal label and value string observed, the scale factor applied and
  the evidence for it, the sign convention, the extraction run, and the model confidence.
- **Interpretation is grounded.** Ratio explanations are either canned and definitional or
  generated strictly from computed numbers. Never free narration over source text.

It runs on your machine. No auth, no hosting, no multi-tenancy. The only network egress is
document content sent to the Anthropic API during extraction.

## Status

M1 (ingest, extract, verify) is complete: file drop, AI extraction with a forced JSON
schema, per-figure provenance, a deterministic reconciliation gate, editable historicals
with reset-to-source, and drag-to-remap for misclassified rows.

M2 (ratios and interpretation) is complete: 25 built-in ratios across five families with
per-period trends, a focus toggle for the core twelve, a workspace-level choice between
average and ending balances, drag-built custom ratios over a safe expression parser, a
DuPont decomposition that shows its own reconciliation, and an on-demand generated reading
per card that is grounded in the computed numbers and cached against them.

M3 forecasting, M4 report and PDF export, and M5 an adversarial user-test pass follow.

The full design spec lives in
[`docs/superpowers/specs/`](docs/superpowers/specs/2026-08-25-financial-modelling-webapp-design.md).

## Architecture

Four layers, each testable without the others.

```
Ingest  ->  Extract  ->  Model  ->  Present
```

- **Ingest** (`src/ingest/`) normalises PDF and XLSX/XLS/CSV into one representation. It
  knows nothing about accounting.
- **Extract** (`src/extract/`) sends normalised content to the Anthropic API with a forced
  output schema, chunks long documents, and merges the results without auto-resolving
  conflicts.
- **Model** (`src/model/`) is pure TypeScript with no React and no I/O. Source facts are
  immutable and user edits layer on top as overrides, so reset-to-extracted always works.
  A purity test enforces the no-I/O rule.
- **Present** (`src/ui/`, `src/app/`) holds no financial logic. Views read computed values
  and dispatch edits.

## Validation gate

After merge, deterministic checks run before anything is shown as trustworthy:

1. Assets = Liabilities + Equity, per period, within a rounding tolerance
2. Cash-flow net change ties to the period-over-period change in balance-sheet cash
3. Subtotals equal the sum of their components
4. Period coverage is complete and consistently ordered
5. Scale factor is consistent across statements within a document

Each failure produces a structured finding with a severity and a remediation action, not
just a message.

## Stack

Next.js App Router, TypeScript, SQLite via better-sqlite3 and Drizzle, dnd-kit for
accessible drag with keyboard equivalents, Vitest, Playwright.

## Running it

```bash
npm install
cp .env.example .env.local   # set ANTHROPIC_API_KEY
npm run dev
```

Without an API key the app still runs; extraction is disabled and says so.

```bash
npm test          # vitest
npm run test:e2e  # playwright, against a seeded throwaway database
npm run lint
npm run build
```

Documents and the SQLite database live under `data/`, which is gitignored. Nothing you
ingest leaves your machine except the content sent to the Anthropic API for extraction.
