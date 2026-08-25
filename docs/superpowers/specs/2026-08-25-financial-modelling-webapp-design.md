# Financial Modelling Webapp — Design Spec

Date: 2026-08-25
Status: approved for planning
Working directory: `~/finmodel` (project name not yet chosen; rename is cosmetic)

## 1. Purpose

A local web application that ingests financial source documents (SEC 10-K/10-Q PDFs,
Excel workbooks, and course-case PDFs with embedded exhibits), extracts the financial
statements into a canonical model, and lets the user manipulate that model: edit
historicals, compute standard and custom ratios, build a driver-based three-statement
forecast with scenarios and sensitivity analysis, and assemble an editable report that
exports to PDF.

Two properties are non-negotiable and drive most of the design:

- **Every extracted number is traceable.** The user can see exactly where a figure came
  from and what transformation was applied to it.
- **Interpretation is grounded.** Explanatory text about ratios is either canned and
  definitional, or generated strictly from computed numbers. It is never free narration.

## 2. Users and context

Single user, running locally on a Mac. No authentication, no multi-tenancy, no
deployment. Documents and derived data stay on disk. The only network egress is
document content sent to the Anthropic API during extraction, and computed numbers sent
during interpretation generation.

## 3. Scope

### In scope

- Ingest of PDF and XLSX/XLS/CSV inputs
- AI-assisted extraction of income statement, balance sheet, and cash-flow statement
- Per-figure provenance capture and display
- Reconciliation validation with user-facing remediation
- Editable historicals with reset-to-source
- Ratio library plus user-built custom ratios
- Driver-based forecasting across a linked three-statement model
- Scenarios (base/bull/bear, extensible) and two-variable sensitivity grids
- Drag-and-drop in four places: file drop, line-item remapping, ratio construction,
  report block layout
- Report builder with inline text editing and PDF export
- Tooltips on every ratio, line item, assumption, and control
- Layered error prevention: blocking banners, inline warnings, transient toasts with undo

### Out of scope (this milestone set)

- Full DCF valuation (WACC build-up, terminal value, enterprise-to-equity bridge).
  Explicitly deferred; see §11.
- Annotating or marking up the original source PDF
- Cloud hosting, sharing, multi-user, or authentication
- Peer/industry benchmark data
- Direct SEC EDGAR fetching (files are supplied by the user)

## 4. Architecture

Four layers. Each has a defined interface and is testable without the others.

```
Ingest  →  Extract  →  Model  →  Present
```

### 4.1 Ingest

Normalises heterogeneous inputs into one intermediate representation.

- PDF → per-page text with positional data, plus per-page rendered images
- XLSX/XLS/CSV → per-sheet cell grids with cell types preserved

Output type: `IngestedDocument { id, kind, pages[] | sheets[], meta }`.

Ingest knows nothing about accounting. It is a pure format-normalisation layer.

Failure modes handled here: unreadable file, encrypted PDF, image-only PDF with no
extractable text, file exceeding the size cap, unsupported extension. Each raises a typed
error that the UI maps to a specific banner (§8.1).

### 4.2 Extract

Sends normalised content to the Anthropic API with a forced JSON output schema, and maps
the response into canonical facts.

Extraction returns, for every figure:

| Field | Meaning |
|---|---|
| `canonicalKey` | Mapped canonical line item (e.g. `revenue`, `total_current_assets`) |
| `rawLabel` | The literal label string observed in the source |
| `rawValue` | The literal value string observed in the source |
| `scaleFactor` | Multiplier applied (1, 1e3, 1e6) with the evidence for it |
| `signConvention` | Whether the source presented the figure as negative/parenthesised |
| `value` | Final normalised number in base currency units |
| `period` | Resolved period identifier (e.g. `FY2024`, `Q2-2025`) |
| `sourceRef` | Document id, page or sheet, and locator within it |
| `confidence` | Model-reported confidence for this figure |

A **canonical line-item taxonomy** is defined as a fixed, versioned list. Anything the
extractor cannot confidently map lands in an `unmapped` bucket, visible and draggable
rather than silently dropped.

Long documents are chunked; each chunk is extracted independently and merged. Merge
conflicts (the same canonical key and period extracted twice with different values) are
surfaced, not auto-resolved.

**Validation gate.** After merge, deterministic checks run:

1. Assets = Liabilities + Equity, per period, within a tolerance of rounding
2. Cash-flow statement net change ties to the period-over-period change in balance-sheet cash
3. Subtotals equal the sum of their components
4. Period coverage is complete and consistently ordered
5. Scale factor is consistent across statements within a document

Each check produces a structured finding with severity and an offered remediation.

**Cost and reruns.** Every extraction is recorded as an `ExtractionRun` with the model id,
prompt version, token usage, and status. Re-running extraction creates a new run rather
than mutating the old one, so a bad rerun can be discarded.

### 4.3 Model

Pure TypeScript. No React, no database access, no I/O. This is the correctness core and
carries the heaviest test burden.

The model is a dependency graph over cells addressed as `(lineItemKey, periodKey,
scenarioKey)`. A cell is one of:

- **Source cell** — a value from extraction
- **Override cell** — a user-entered value that shadows a source cell
- **Computed cell** — an expression over other cells

Evaluation is a topological sort with cycle detection. Genuine accounting circularity
(interest expense depending on average debt, which depends on cash, which depends on
interest) is resolved by a bounded iterative solver with a convergence tolerance and a
hard iteration cap. Non-convergence is an error surfaced to the user, never a silently
returned partial result.

**Overrides are layered, never destructive.** Source facts are immutable. This guarantees
"reset to extracted value" always works and provenance is never lost to user editing.

Forecasting is expressed as drivers: growth rates, margins, working-capital days
(DSO/DIO/DPO), capex as a percentage of sales, depreciation policy, tax rate, and a debt
schedule. Drivers are scenario-scoped. Sensitivity analysis re-evaluates the graph across
a grid of two driver values and reports a chosen output metric.

Ratios are expressions over the same graph, so a custom ratio is not a special case — it
is a computed cell with a user-supplied expression.

### 4.4 Present

React views over the model. Statement grids, ratio cards, charts, assumption panels, and
report blocks. Views hold no financial logic; they read computed values and dispatch
edits.

## 5. Data model

```
Document        id, filename, kind, hash, size, ingestedAt, storagePath
ExtractionRun   id, documentId, modelId, promptVersion, status, tokensIn/Out, createdAt
Fact            id, runId, canonicalKey, periodKey, value, provenance(json), confidence
Period          key, label, type (FY|Q), endDate, ordinal
LineItem        canonicalKey, statement, label, order, definition
Workspace       id, name, documentIds[], createdAt
Override        id, workspaceId, canonicalKey, periodKey, scenarioKey, value, note
Scenario        id, workspaceId, name, isBase
Driver          id, scenarioId, key, periodKey, value
Ratio           id, workspaceId|null, key, label, expression, definitionText
Report          id, workspaceId, blocks(json), updatedAt
```

Facts are append-only per run. Deleting an extraction run deletes its facts; overrides
survive and reattach by `canonicalKey`+`periodKey`, with any orphans flagged.

## 6. Provenance display

Clicking any figure opens a provenance panel showing: the source document and page or
sheet, the literal label text observed, the literal value string observed, the scale
factor applied and why, the sign convention, the extraction run and model that produced
it, the confidence, and — if the user has edited it — the override value alongside the
original with a one-click reset.

For PDF sources the panel renders the relevant page region so the user sees the actual
printed figure, not a claim about it.

## 7. Interpretation

Split deliberately into two halves:

**Definitional (deterministic).** Each ratio in the library carries static, authored text:
what it measures, how it is computed, what direction is generally favourable, and the
standard caveats. No API call. This text is identical every time and can be reviewed once
for correctness.

**Situational (generated).** A short read of what the computed numbers actually did across
periods and scenarios. The generation prompt receives only computed values, period labels,
and the ratio definition — never raw document text. It is instructed to describe movement
and its arithmetic drivers, and to decline where the data does not support a claim.

Custom ratios get the situational half only, plus the user's own note field.

## 8. Error prevention

### 8.1 Blocking banners

Persistent, in-context, and each carries a remediation action rather than only a message.

| Condition | Remediation offered |
|---|---|
| Balance sheet does not balance | Show the imbalance by period, jump to the suspect items |
| Cash flow does not tie to cash movement | Show the gap, jump to the reconciling lines |
| Extraction failed or returned nothing usable | Retry, retry with page range, or switch input |
| Encrypted or image-only PDF | Explain and offer alternative input |
| Missing `ANTHROPIC_API_KEY` | Explain where to set it; app remains usable in read-only mode |
| Unresolved circular reference | Name the cycle, offer to break it at a chosen cell |
| Material line items left unmapped | Jump to the unmapped bucket for drag-remapping |
| Merge conflict between chunks | Show both candidates, let the user pick |

### 8.2 Inline warnings

Attached to the offending cell or field, not the page: low extraction confidence, scale
factor inferred rather than stated, driver value outside a plausible range, override
diverging from the extracted value beyond a threshold, ratio with a zero or negative
denominator.

### 8.3 Toasts

Transient confirmations only: saved, exported, extraction complete or failed. Every
destructive action — deleting a line item, clearing a scenario, a drag that reorganised
structure, discarding an extraction run — emits a toast carrying undo.

Rationale for the three tiers: if reconciliation failures and save confirmations use the
same channel, the user learns to dismiss both.

## 9. Drag and drop

Four surfaces, all via dnd-kit, all keyboard-accessible with an equivalent non-drag path
(every drag action also exists as a menu action, because drag-only functionality is not
operable for everyone and is untestable without pointer simulation):

1. **File drop** — anywhere on the workspace, ingests and starts extraction
2. **Line-item remap** — drag a row between statement buckets or out of `unmapped`;
   the model recomputes and reconciliation re-runs immediately
3. **Ratio builder** — drag line-item chips into numerator and denominator targets;
   live preview of the computed value before saving
4. **Report layout** — drag blocks (statement table, ratio card, chart, commentary,
   assumption summary) into order

## 10. Tooltips

A single registry module maps every tooltip key to its text. Ratios, line items,
assumptions, validation findings, and controls all resolve their help text from it. A test
asserts that every registered ratio, canonical line item, and driver has a corresponding
entry, so nothing ships with missing or contradictory help.

## 11. Milestones

Each ends in a usable application. Tooltips and error handling are built within each
milestone, not deferred to the end.

**M1 — Ingest, extract, verify.** Drop a document, get canonical statements, edit them,
see provenance on every figure, get reconciliation banners, drag-remap misclassified rows.
Heaviest test investment: this milestone determines whether anything downstream can be
trusted.

**M2 — Ratios.** Built-in library across liquidity, leverage, efficiency, profitability,
and coverage, with period trends. Drag-built custom ratios. Interpretation cards.

**M3 — Forecast, scenarios, sensitivity.** Driver assumptions flowing through a linked
three-statement model. Base/bull/bear scenarios. Two-variable sensitivity grid.

**M4 — Report and PDF.** Drag block layout, inline commentary editing, PDF export via
server-side print of the report route. The PDF is a render of the model; the model
remains the source of truth, so reports are re-editable and re-exportable indefinitely.

**M5 — User-test pass.** Drive the running application in Chrome end-to-end, adversarially:
corrupt PDF, encrypted PDF, very long filing, a workbook with no recognisable statements,
deleting a line item that ratios depend on, exporting mid-recalculation, switching
scenarios with unsaved overrides. Fix what breaks or confuses.

**Deferred.** Full DCF valuation is a candidate M6 and is deliberately excluded from M3 to
keep the forecast engine's scope bounded.

## 12. Testing strategy

- **Model layer:** unit tests over the dependency graph — evaluation order, cycle
  detection, iterative convergence and its failure, override layering, scenario isolation,
  sensitivity grid correctness. Fixture-based three-statement models with known answers.
- **Validation gate:** table-driven tests over deliberately broken statement sets.
- **Extraction:** golden-file tests against committed fixture documents with hand-verified
  expected facts. The API call is stubbed in tests; a separate opt-in live test exercises
  the real call.
- **Tooltip registry:** completeness assertion.
- **UI:** Playwright coverage of each drag surface and its non-drag equivalent, plus the
  M5 adversarial paths.

## 13. Technology decisions

| Choice | Rationale |
|---|---|
| Next.js 15 App Router + TypeScript | Server-side file handling and API routes in one process |
| SQLite (better-sqlite3) + Drizzle | Local, durable across restarts, zero setup, typed migrations |
| Files on disk under `data/` | Documents stay local and are not stored in the database |
| dnd-kit | Accessible drag primitives with keyboard support |
| TanStack Table | Large statement grids with editable cells |
| Recharts | Trend and sensitivity visualisation |
| Playwright print-to-PDF | Export renders exactly what was edited; already available locally |
| Anthropic API, structured output | One extraction code path across all three input formats |

UI work follows the house `anti-vibecode` standards.

## 14. Open questions

None blocking. Project naming, the exact canonical line-item taxonomy version, and the
ratio library's initial membership are settled during M1 and M2 planning respectively.
