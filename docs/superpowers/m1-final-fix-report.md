# M1 final fix wave

Whole-branch review fixes. All thirteen findings addressed. Seven commits, grouped by concern.

| Commit | Subject | Findings |
|---|---|---|
| `031a9ea` | fix: enforce the period-key ordering contract at both ends | 1, 2, 3, 8 |
| `b295f84` | test: purity guard covers src/server, src/ui and Node builtins | 4 |
| `845ae77` | feat: read CSV, drop the .xls promise, and close the remediation gaps | 5, 6, 7 |
| `2d8262d` | fix: honest tooltip copy, a reset in the provenance panel, real metadata | 11, 12, 13 |
| `680a19d` | fix: identify the 404 boundary by type, not by message prefix | 9 |
| `4ef1a7a` | test: give the Claude client a seam and pin its Global Constraints | 10 |
| `d4831c0` | fix: missing_periods tooltip covers all three cases it now reports | 11 (follow-on) |

Gates, on the final tree: `npx tsc --noEmit` clean, `npx eslint src` clean, `npm test` 24 files / 214 tests passing (was 21 / 156).

---

## 1. The period-key ordering contract

New `src/model/periods.ts` is the single definition: `PERIOD_KEY_PATTERN`, `periodRank`, `sortPeriodsMostRecentFirst`, `isRankablePeriodKey`, `isImmediatePredecessor`, `missingPeriodsInSequence`. Pure, no imports, so both `extract/` and `server/` may use it.

Boundary end: `ExtractionSchema` now types `period_key` (and every entry of the document-level `periods` list) with a zod regex rather than a `.describe()` string. `src/extract/schema.test.ts` covers `FY24`, `2024`, `Q2 2025`, `Q5-2025` and the empty string.

Model end: `validate` no longer treats `periods[i + 1]` as the prior period on faith.

**Judged differently:** the finding asked for a refusal when `periodRank` cannot rank a key. I made the guard stronger — the comparison runs only when the next entry is the *immediate predecessor in the same family* (`isImmediatePredecessor`). Unrankable keys are still refused, and so are two further false-positive routes the same bug has: a gap in the sequence (FY2024 against FY2022, where the cash movement between them says nothing about FY2024's net change) and a family crossing (Q1-2025 against FY2024, comparing a quarterly net change against an annual cash movement). Both would have produced the same confident, false blocking banner. Nothing that was previously flagged legitimately stops being flagged: genuinely adjacent periods still compare, covered by a test that asserts exactly that.

## 2. Spec check 4

`validate` now implements "period coverage is complete and consistently ordered", reusing `missing_periods`:

- unrankable keys → **blocking**, naming the offending labels, because every ordering-dependent check below it is unsafe;
- a gap in an otherwise regular annual or quarterly run → **warning**, naming the missing periods, because a filing legitimately may not report the intervening period.

Annual and quarterly runs are considered independently, so FY2024 + FY2023 + Q1-2025 is not a gap. This is the check that would have caught finding 1, and its blocking case is what now suppresses that false banner.

## 3. Money compared with `===` in `merge.ts`

`new Set(candidates.map(c => c.value))` replaced with `candidates.some(c => !closeEnough(c.value, best.value))`. Two tests: 1,000,000 against 1,000,400 is one fact, 1,000,000 against 1,050,000 is a conflict.

## 4. The purity guard

Added to `isForbiddenModule`: `@/server`, `@/ui`, every `node:*` specifier, and every bare Node builtin name (from `builtinModules`, so the list cannot fall behind the runtime).

Also fixed the false positive: `import { type Provenance } from "@/db/schema"` sets `isTypeOnly` on each specifier, not on the clause, so the guard called it a runtime import. `importIsTypeOnly` / `exportIsTypeOnly` now read both, while still counting a default binding, a namespace import, a mixed specifier list and a bare side-effect import as runtime. Four unit tests cover the distinction directly.

### Mutation proofs

Each mutation was prepended to `src/model/validate.ts`, `npx vitest run src/model/purity.test.ts` was run, and the file reverted with `git checkout --`. Real output, trimmed to the assertion line:

**`@/server`** — `import { realDeps } from "@/server/deps";`
```
× validate.ts imports no other layer 7ms
AssertionError: validate.ts: static import of forbidden module "@/server/deps" — import { realDeps } from "@/server/deps";: expected true to be false
Tests  1 failed | 14 passed (15)
```

**`@/ui`** — `import { formatMoney } from "@/ui/format";`
```
× validate.ts imports no other layer 5ms
AssertionError: validate.ts: static import of forbidden module "@/ui/format" — import { formatMoney } from "@/ui/format";: expected true to be false
Tests  1 failed | 14 passed (15)
```

**`node:fs`** — `import fs from "node:fs";`
```
× validate.ts imports no other layer 5ms
AssertionError: validate.ts: static import of forbidden module "node:fs" — import fs from "node:fs";: expected true to be false
Tests  1 failed | 14 passed (15)
```

**bare builtin** — `import fs from "fs";`
```
× validate.ts imports no other layer 5ms
AssertionError: validate.ts: static import of forbidden module "fs" — import fs from "fs";: expected true to be false
Tests  1 failed | 14 passed (15)
```

**Regression check on the type-only change**, to prove the relaxation did not open the `@/db` rule — `import { getDb } from "@/db/client";`
```
AssertionError: validate.ts: non-type static import of "@/db" — import { getDb } from "@/db/client";: expected false to be true
Tests  1 failed | 14 passed (15)
```

Every revert landed: `git diff --stat src/model/validate.ts` was empty after each, and `git status --short` after the last showed only `src/model/purity.test.ts` (the intended change). The committed diff was read before committing.

## 5. Remediation gaps

`IngestErrorCode` is now derived from an exported `INGEST_ERROR_CODES` array, in the same shape as `FINDING_CODES` and `CONTROL_KEYS`. `REMEDIATION` is exported and gained `unreadable` and `extraction_failed`. `unreadable` copy tells the user the file is damaged or is not the format its extension claims, and to re-save or re-export a fresh copy (and that a part-finished download fails the same way) — advice that can actually work, unlike "try the upload again".

Three tests in `src/server/documents.test.ts`: every `IngestErrorCode` has an entry, every code `ingestAndExtract` can return has an entry, no entry is empty.

## 6. `.xls`

Dropped from `src/ingest/index.ts`, `src/ui/DropZone.tsx` (`accept`), and the `unsupported_type` remediation. The unsupported-type message now names what is supported: `.pdf`, `.xlsx`, `.xlsm`, `.csv`. Tests assert `.xls` is rejected as `unsupported_type` and that the message does not list it.

## 7. CSV

`readCsv` in `src/ingest/spreadsheet.ts` reads via `wb.csv.read(Readable.from(bytes))` into the same `SheetGrid` shape, sharing the grid extraction with the xlsx path (`gridsFrom`). Routed on `.csv` in `ingest`, added to the `accept` attribute and to the drop-zone copy. Four `readCsv` tests plus one end-to-end through `ingest`; numeric cells arrive as numbers, so nothing downstream changes.

The single sheet is named `CSV`, since a CSV carries no sheet name and provenance displays one.

## 8. Duplicated `periodRank`

Both copies deleted; `extract/merge` and `server/documents` import `sortPeriodsMostRecentFirst` from `@/model/periods`. Ordering tests live in the new `src/model/periods.test.ts` (13 tests). `merge.test.ts` keeps its own "collects the union of periods, most recent first", which is a statement about `mergeFigures`, not about ranking.

## 9. The 404 boundary

`src/server/errors.ts` holds `WorkspaceNotFoundError` (with `code: "workspace_not_found"`) and an `isWorkspaceNotFound` guard. Both `loadWorkspace` and `remapFact` raise it, so the two message shapes are gone. `page.tsx` matches on the type.

The guard checks `instanceof` first and the `code` field second, so a copy of the class arriving from a separately bundled module still reads as the same condition — failing that check open would turn a 404 into a 500, which is the failure mode the finding is about. A test asserts an unrelated `Error` whose message begins "No workspace-wide setting…" is *not* mistaken for it.

## 10. The Claude client seam

`callClaude(chunk, api = getClient())`. `ClaudeApi` describes only what the module uses — `files.upload` and `messages.parse` — with the request parameter type derived from the SDK's own (`Parameters<Anthropic["messages"]["parse"]>[0]`), so a malformed request is still a compile error. A real `Anthropic` satisfies the interface structurally; no cast, no `any`.

**The request shape is unchanged.** `src/extract/client.test.ts` (12 tests) pins:

- `model` is exactly `claude-opus-5`, with no date suffix;
- `thinking` deep-equals `{ type: "adaptive" }`, and `budget_tokens` appears nowhere in the serialised body;
- `output_config.format` matches `zodOutputFormat(ExtractionSchema)` and carries its `parse` function, and the deprecated top-level `output_format` is absent;
- `parsed_output` is guarded, not asserted;
- refusal → `ExtractionRefusedError` with the category (and with no `stop_details` at all);
- `max_tokens` → `ExtractionTruncatedError` naming the chunk;
- no key and no injected client → `MissingApiKeyError`;
- the PDF is uploaded once per buffer across chunks, and a failed upload is not cached.

**Worth knowing about finding 1's boundary:** `zodOutputFormat` does not emit `pattern` into the wire schema. It folds it into the field's `description` as `{pattern: "^(FY\\d{4}|Q[1-4]-\\d{4})$"}`, so the model is told the shape but the server-side grammar does not enforce it. Enforcement is client-side, in the zod parse the SDK runs over the response inside `messages.parse` — a malformed key throws there and the chunk fails loudly rather than seeding a bad period list. That is still "rejected at the boundary", and it carries no risk of a 400 from an unsupported JSON-schema keyword.

## 11. Tooltip copy and dead registry entries

`control.dismiss_banner` now reads: hidden for the rest of this session, nothing about the figures changes, and it comes back on a page reload while the problem is still there. That is what the code does — `dismissed` lives in `WorkspaceScreen` state and `router.refresh()` does not remount.

`control.rerun_extraction` and `control.scale_badge` removed: no call sites, and no control to attach them to. `control.dismiss_banner` was kept and wired up — `Banner`'s dismiss button now carries it, which is the control the copy describes.

The completeness test gained "has no control key without a call site": it walks `src/`, skipping tests and the registry itself, and greps for `tooltip("…")`. An unused key now fails.

Follow-on (`d4831c0`): `finding.missing_periods` copy described only the "none found" case, while the code now reports three. Rewritten to cover all three and to say that cross-period checks are only made where the order is certain.

## 12. Reset in the provenance panel

`ProvenancePanel` takes a required `onReset` and renders a flat, labelled "Reset to extracted value" button below the value rows, only when `cell.source === "override"`. It reuses the grid's clear-override path: `WorkspaceScreen` passes the same `reset(key, period)` the table uses, so the toast and its undo are unchanged.

The panel closes as it resets. Its `cell` is a snapshot captured when it opened, and `router.refresh()` does not update that snapshot, so leaving it open would show a "Your value" row for an override that no longer exists. Closing is the honest outcome, and the toast carries the confirmation and the undo.

Two tests: both values shown with a working reset for an overridden cell, and no reset control for a cell the user has not touched.

## 13. Metadata

`title: "Finmodel"`, with a one-line description of what the app does.

---

## Not done, and why

Nothing was left unfixed. The listed deferrals (merge-conflict candidate picker, `Finding.keys` jump-to-cell, read-only mode without an API key, workspace-wide file drop, multi-document workspaces) were not touched, as directed.

## Residual risks

- **`missingPeriodsInSequence` treats a fiscal-year label as a calendar year.** A company whose FY2024 ends in June still labels it FY2024, so the sequence arithmetic holds. A document mixing two companies' fiscal calendars in one period list is out of scope for M1.
- **The gap warning can fire on a legitimately sparse filing** (a document that reports FY2024 and FY2022 only). It is a warning, not a block, and its remediation says the comparison across the gap was not made — which is the useful half of the message.
- **`uploads` is still a module-level `WeakMap`** keyed by buffer identity. Tests use distinct buffers, so they do not share entries; a test that reused one buffer across two fake clients would see the first client's upload. Keying the cache per client would need the map to hang off the client, which the SDK type does not offer a slot for.
