# SDD ledger — plan: docs/superpowers/plans/2026-08-25-m1-ingest-extract-verify.md

Spec: docs/superpowers/specs/2026-08-25-financial-modelling-webapp-design.md (read)
Branch: main. Ruling: work proceeds on main with no branch — Caleb's standing recorded preference is commit+push to main directly, no branching. Cost if wrong: history is linear and un-gated; revert by commit.
BASE at start: 4941dfc

## Preflight conflict scan

| # | Tasks | Produces vs consumes | Finding |
|---|---|---|---|
| 1 | T1 → T5,T6,T8,T11 | `TAXONOMY`, `LineItemDef`, `lineItem`, `itemsFor` | clean |
| 2 | T2 → T4,T6,T10 | `Provenance` field names | clean, identical field set in all three |
| 3 | T3 → T4,T7 | `IngestedDocument` | clean |
| 4 | T4 → T6 | `ExtractedFact` vs `ExtractedFactLike` | clean, structurally identical |
| 5 | T4 → T11 | T4 drops unmapped figures; T11 step 5 rewrites `mergeFigures` to keep them and amends T4's tests | CONFLICT (staged) |
| 6 | T4/T5 → T7 | `output.conflicts` computed but no column stores it; `loadWorkspace` never passes `conflicts` to `buildWorkspace` | CONFLICT (real gap) |
| 7 | T7 interface block vs code | block says `runId: string`, code returns `string \| null` | doc typo, code is right |
| 8 | T5 → T8 | `FindingCode` union vs the literal `FINDING_CODES` array in the tooltip test | duplication, drift risk |
| 9 | T9 → T1 | T9 replaces `src/app/page.tsx` and adds jsdom/testing-library deps T1 did not install | clean, T9 states both |
| 10 | T10 → T11 | T11 modifies `WorkspaceScreen`/`StatementTable` created in T10 | clean |
| 11 | T10 self | `EditableCell` fires `onClick` (inspect) before `onDoubleClick` (edit) | self-conflict, minor |
| 12 | T5 self | test fixtures vs validator logic, all six checks traced by hand | clean |
| 13 | T3 self | `readSpreadsheet` padding/formula handling vs its own tests | clean |

## Preflight rulings

- Ruling (row 5): accept the staged rewrite as written — T4 ships the simple merge, T11 amends it with its own test updates. Sequencing is deliberate, not contradictory. Cost if wrong: one round of churn in `merge.test.ts`.
- Ruling (row 6): close the gap rather than ship a dead finding. Spec §8.1 requires a merge-conflict banner, so `extraction_runs` gains a `conflicts` JSON column in T2, T7 persists `output.conflicts`, and `loadWorkspace` passes them to `buildWorkspace`. Carried into the T2 and T7 dispatches. Cost if wrong: one unused column.
- Ruling (row 7): code wins over the interface block. `runId` is nullable. Cost if wrong: none.
- Ruling (row 8): T8's tooltip test derives its finding-code list from an exported `FINDING_CODES` array in `src/model/validate.ts` rather than a hand-copied literal, so the union and the tooltip registry cannot drift. Cost if wrong: trivial.
- Ruling (row 11): single-click inspects, double-click edits — the click handler must not fire when a double-click is in progress. T10's implementer uses `onDoubleClick` for edit and a short click-delay guard, or moves inspect to an explicit control. Left to the implementer, flagged to its reviewer. Cost if wrong: minor UX annoyance, fixable later.

## Progress
Task 1: review — spec ✅ on taxonomy/structure/interfaces; one Important finding (scaffold resolved Next 16, constraint said Next 15, undisclosed).
Task 1: Ruling: accept Next 16 — the plan's "Next.js 15" named the App Router generation, not a pin; the scaffold builds, lints and tests clean, and downgrading buys nothing. Cost if wrong: a later task hits a Next 16 breaking change and we pin to 15 then, re-running the scaffold.
Task 1: minor (deferred): @types/better-sqlite3@9 against better-sqlite3@13 — v13 may bundle its own types; carried into Task 2's dispatch.
Task 1: minor (deferred): package.json gained "type": "module" beyond brief scope; watch for CJS-only tooling (drizzle-kit config).
Task 1: complete (commits 4941dfc..4b21842, 1 finding ruled, 2 minors deferred)
Task 2: minor (deferred): workspaces→overrides cascade defined but untested.
Task 2: minor (deferred): DB file path computed independently in drizzle.config.ts and db/client.ts.
Task 2: complete (commits 4b21842..74d18c2, review clean)
Task 3: minor (deferred): boolean-cell normalisation branch untested; no dedicated pdf.test.ts, encrypted_pdf path untested (both inherited from the brief's own test plan).
Task 3: complete (commits 74d18c2..b57c1cc, review clean)
Task 4: review — spec ✅ verbatim, all API-contract constraints hold; 3 Important findings, all plan-mandated defects.
Task 4: Ruling: finding 1 (pageRange spans a non-contiguous filtered page set, so the prompt names a 57-page window while sending 6 pages) is real and defeats the page filter — fix by passing the explicit page list instead of a from/to range, and add chunkDocument tests. Cost if wrong: none, strictly more truthful.
Task 4: Ruling: finding 2 (whole PDF re-attached per chunk; >~24MB PDFs exceed the 32MB request limit and every chunk 400s) — prefer a single Files API upload referenced by file_id per chunk; if the installed SDK cannot do that cleanly, fall back to an explicit coded size guard with actionable remediation. Keep the extracted page text alongside the attachment: fidelity of printed labels is worth the tokens. Cost if wrong: extra token spend per document, visible in the run's recorded usage.
Task 4: Ruling: finding 3 (max_tokens 16000 shared with adaptive thinking; truncation is misreported as unparsable output) — branch on stop_reason "max_tokens" with its own message, raise max_tokens to 32000, and bound thinking with output_config.effort "medium". Cost if wrong: slower or pricier extraction, tunable in one place.
Task 4: minor (deferred): exact-equality conflict detection on doubles (merge.ts:76); periods collected before the unmapped guard so dropped rows still create empty period columns (merge.ts:60); stale doc comment on ExtractionChunk.text; non-Error rejections stringify to undefined in chunkErrors; spreadsheet chunks have no size cap; Anthropic client caches the first API key for the process lifetime.
Task 4: fix round 1/5 (3 addressed, 0 open; commits 45e4aad..50fbc82)
Task 4: minor (deferred): uploaded PDFs never expire (no expires_in_seconds) so Files storage grows unbounded; formatPageList([]) renders "pages  and undefined" (unreachable today); client.ts constructs its own Anthropic singleton so upload/refusal/truncation branches are untestable without a key.
Task 4: complete (commits b57c1cc..50fbc82, review clean after 1 fix round)
Task 5: Ruling: the brief's subtotal check ("skip if ANY component undefined") contradicts the brief's own subtotal test (2 of 5 components supplied, finding expected). Implementer resolved it to "skip only if NO component is present"; accepted. Rationale: the strict form is near-dead code on real filings, where the taxonomy will rarely capture every component line, whereas the loose form surfaces exactly the useful signal — the reported subtotal exceeds what we captured, so some amount is unaccounted for. It is severity warning and its remediation copy already leads with that reading. Cost if wrong: partially extracted statements carry extra warning banners; tighten the check in one place if it proves noisy in the M5 user-test pass.
Task 5: Ruling: income-statement subtotals (gross_profit, operating_income, pretax_income, net_income) and total_liabilities have no taxonomy children pointing at them, so the generic subtotal check never exercises them. Deferred rather than fixed here: those are formula relationships (revenue - cost_of_revenue = gross_profit), not parent/child sums, and they belong to the M3 calc engine, not this parent-key mechanism. total_assets stays covered by the balance-sheet identity check. Cost if wrong: an income statement whose printed subtotals disagree with its own components passes M1 unflagged.
Task 5: minor (deferred): two distinct cash tie-out checks share one finding code, distinguishable only by their keys array, and one broken value trips both; non-null assertion on input.confidenceAt inside the loop; money() hardcodes en-US.
Task 5: complete (commits 50fbc82..0662a36, review clean)
Task 6: review — spec ✅ on the workspace itself; one Important plan-mandated finding: the purity guard has vacuous-pass gaps (no dynamic import()/require() detection; the @/db type-only check is anchored to single-line imports, so a reformatted multi-line runtime import passes silently).
Task 6: Ruling: fix the guard rather than accept it. It is the only mechanism keeping the model layer pure, and a guard nobody has watched go red is not a guard. Fix round 1 requires a mutation proof: introduce a real violation, observe the failure, revert. Cost if wrong: none.
Task 6: fix round 1/5 (1 addressed, 2 new same-class gaps opened: template-literal dynamic import, @/db re-export; commits ba0b71a..4ade439)
Task 6: fix round 2/5 (2 addressed, 0 open — guard rewritten onto a recursive TypeScript AST walk; commits 4ade439..b23c4e7)
Task 6: minor (deferred): guard rejects TypeScript's inline per-specifier type modifier (import { type X } from "@/db/schema"), which is legitimately type-only — a false positive to fix if anyone writes that form; one mutation-proof transcript line in the report shows a semicolon the code would not print (evidence hygiene, pass/fail logic unaffected).
Task 6: complete (commits 0662a36..b23c4e7, review clean after 2 fix rounds)
Task 7: review — conflicts amendment, Deps injection, Next.js boundary and override semantics all correct; the out-of-scope extract.ts fix confirmed a genuine additive bug fix Task 4's assertions survive. Two Important findings + one confirmed gap.
Task 7: Ruling: finding 1 (writeFile and the pre-extraction inserts sit outside any try, and the override actions have none, so real I/O and DB failures throw across the server-action boundary) is a violation of a global constraint that outranks the brief's snippet — fix. Cost if wrong: none.
Task 7: Ruling: finding 2 (merge_conflict is blocking severity, its remediation tells the user to keep the correct value, and the only affordance for that — an override — does not clear it) — fix by filtering persisted conflicts against existing overrides in loadWorkspace, matching the convention workspace.ts already uses for low_confidence. Cost if wrong: a resolved conflict could re-surface if the user later clears the override, which is arguably correct anyway.
Task 7: Ruling: the reviewer's "cannot verify" item is a real gap — the error-code propagation path (missing_api_key / refused reaching REMEDIATION) reads correctly but nothing pins it. Requiring a test as part of this fix round.
Task 7: Ruling: minors 3 and 5 (one coded failure among many uncoded ones still attaches its code; ExtractionTruncatedError has no REMEDIATION entry so truncation advises "try the upload again") are folded into finding 1's remit — same mechanism, both cheap, both user-facing wrong advice. Minor 6 (`let doc;` evolving any) folded in as a global-constraint violation.
Task 7: minor (deferred): periodRank duplicated verbatim between extract/merge.ts and server/documents.ts; failed extractions leave orphaned document rows and files with no hash dedupe; overrides lacks a unique index on (workspace_id, canonical_key, period_key) so cross-process writes could duplicate a cell.
Task 7: fix round 1/5 (2 Important + 1 gap + 3 folded-in addressed, 1 residual open: catch-block DB write unguarded; commits 97b4e6b..66106e3)
Task 7: fix round 2/5 (residual + arrayBuffer path + duplicated copy addressed, 0 open; boundary invariant traced entry-to-exit across all three actions; commits 66106e3..c81ea59)
Task 7: minor (deferred): revalidatePath calls remain unguarded in all three actions; DB_ERROR_REMEDIATION string duplicated between actions.ts and documents.ts.
Task 7: complete (commits b23c4e7..c81ea59, review clean after 2 fix rounds)
Task 8: Ruling: the plan-mandated tabIndex={0} on Tooltip's wrapper span adds a second, unlabeled tab stop when it wraps an already-focusable child. No call site exists yet, so it does not bite today; carried into Task 10's dispatch, where Tooltip first wraps buttons. Cost if wrong: a keyboard paper cut, cheap now and awkward to retrofit later.
Task 8: minor (deferred): Tooltip's border/shadow classes were softened from the brief's literal values on a house-style citation without asking — functionally harmless and disclosed, but a style rule does not by itself authorise overriding specified values.
Task 8: complete (commits c81ea59..11e9f0d, review clean)
Task 9: review — spec ✅, error tiers correct, carried Tooltip decision honoured (Tooltip wraps the non-interactive text, not the button). Three Important findings.
Task 9: Ruling: findings 1 and 2 (unguarded dragleave causes the classic border flicker; the sr-only file input lacks disabled={busy}, giving keyboard users a live double-submission path the disabled button does not close) are real bugs — fix both.
Task 9: Ruling: finding 3 (jsdom@30 declares engines node ^22.22.2 || ^24.15.0 || >=26, excluding the stated Node 20 baseline) — the baseline is stale, not the dependency. This machine runs Node v24.15.0. Raise the project baseline to Node 22+ and record it in package.json engines so it is explicit rather than implied. Cost if wrong: a contributor on Node 20 cannot run the test suite; they would see a clear engines error rather than a mystery.
Task 9: minor (deferred): multi-file drop silently uses only the first file; ToastProvider timers are not cleared on unmount; globals.css lost its prefers-color-scheme block in favour of one committed dark look (disclosed, allowed by the house standard, but outside the brief's file list).
Task 9: fix round 1/5 (3 addressed, 0 open; commits 0bcf948..d035a0b)
Task 9: complete (commits 11e9f0d..d035a0b, review clean after 1 fix round)
Task 10: review — core mechanics solid and better than the brief (blocking-banner tier, click/Enter/Space split, Escape-blur fix with mutation evidence, real focus management). Six Important findings.
Task 10: Ruling: accept the AGENTS.md/CLAUDE.md commit. `next dev` regenerates both on every run; committing them keeps the tree clean and the content is Next's own generated block. Cost if wrong: two tracked files that churn if Next changes their content.
Task 10: Ruling: finding 4 — fix Tooltip itself (gate tabIndex on whether the child is already focusable, forward aria-describedby) rather than routing around it with native title attributes. The workaround made help on the figure and reset buttons hover-only, which is unreachable by keyboard and generally ignored by screen readers, and it added roughly one unlabelled tab stop per row. This edits Task 8's file, which is expected and fine. Cost if wrong: a shared component changes under a task already reviewed; its own tests cover it.
Task 10: Ruling: finding 3 — banner titles must lead with the specific fact and carry the generic explanation as tooltip help, matching the shape the same file already uses for save failures. Cost if wrong: none.
Task 10: minor (deferred): ProvenancePanel has role="dialog" without aria-modal or a focus trap; focus restore reads document.activeElement at mount (fragile in Safari); two edits to one cell before router.refresh lands make the second undo clear rather than restore; rows where every cell is absent are dropped so a missed line item cannot be typed in (brief-mandated, a product gap for a later milestone); no optimistic update so the grid lags the toast; "1 figure were extracted" grammar bug in validate.ts.
Task 10: fix round 1/5 (6 Important + 2 extras addressed, 0 open; mutation checks verified genuinely red; commits 3f94770..1283d21)
Task 10: minor (deferred): Finding.keys is now overloaded (line-item keys for most codes, a StatementKind for missing_statement) held only by a comment; Tooltip's focusability gate is tag-based so an <a> without href or an aria-disabled control would be mis-detected (unreachable today); Banner's title now sits inside an inline-flex span (phrasing-content nesting); the retry control unmounts while pending so a retry in flight has no visible feedback and focus drops to body — Banner still has no disabled state.
Task 10: complete (commits d035a0b..1283d21, review clean after 1 fix round)
Task 11: review — merge rewrite and loadWorkspace split traced correct, no unmapped fact can reach buildWorkspace, a total, or any validate check. One Important finding.
Task 11: Ruling: the clash check queries facts only, so a remap onto a cell holding an override succeeds and hides the figure behind the override value — the exact outcome the rejection case exists to prevent, reached via the other table. Fix by passing the workspace into remapFact and checking both tables. Folding in the unscoped-id minor at the same time, since scoping the call is what makes the override check possible. Cost if wrong: remapFact gains a parameter; its tests cover it.
Task 11: fix round 1/5 (1 Important + 6 cheap items addressed, 0 open; commits 84ef9b6..b95d296)
Task 11: minor (deferred): nothing fails if the canonicalKey or periodKey predicate is dropped from the override clash query — the over-broad-rejection direction is untested (code verified correct by reading); a workspace with a null activeRunId reports "does not belong to this workspace", which is true but not what happened; stray blank line in WorkspaceScreen.tsx.
Task 11: complete (commits 1283d21..b95d296, review clean after 1 fix round)

Controller verification at 4941dfc..b95d296: npx tsc --noEmit exits 0; npm test 21 files / 156 tests passing, no skips.

## Final whole-branch review — rulings
Ruling: fix in one wave — findings 1 (period-key contract unenforced, Critical), 2 (spec check 4 never shipped), 3 (money compared with === in merge.ts), 4 (purity guard does not forbid @/server, @/ui or node: builtins), 5 (unreadable/extraction_failed have no remediation), 6 (.xls advertised but unreadable), 7 (periodRank duplicated across a layer boundary), 8 (404 boundary identified by a string prefix), 10's factually wrong dismiss_banner copy, 12 (client.ts has no seam so four global constraints are untestable), the silently dropped CSV ingest from spec §3/§4.1, spec §6's reset control in the provenance panel, and the create-next-app metadata still in layout.tsx. All are small and several are one-liners.
Ruling: defer findings 9 and 11 to M2 — showing merge-conflict candidates and wiring Finding.keys into jump-to-cell banner actions are both real spec §8.1 gaps, but they are feature work with UI surface, not defects in what shipped. The remediation TEXT ships on every finding; the ACTION does not. Recorded so it is a decision rather than an omission. Cost if wrong: users get correct guidance they must act on manually for one milestone.
Ruling: defer §8.1 read-only mode, §9 workspace-wide file drop, and multi-document workspaces to M2 — all are additive and none makes shipped behaviour wrong.
Final fix wave: 13/13 addressed across 7 commits (b95d296..d4831c0). Re-review verdict: ready to merge.
Ruling: park the 10-Q gap warning. missingPeriodsInSequence fires on the standard 10-Q shape (Q1-2025 plus the Q1-2024 year-ago comparative), warning that Q2-Q4 2024 are skipped when the document was never going to report them. Parked rather than fixed: it is warning severity, its remediation text happens to be accurate and useful, and the process allows one fix wave only. Cost if wrong: a noisy but correct warning on the first real 10-Q — surfaced to Caleb as the first thing to fix in M2.
Ruling: park the two Minor artefacts — ingest/index.test.ts pins the exact ".xls," punctuation so re-adding .xls differently would slip past (the real rejection test still holds), and merge.ts now compares candidates to best rather than pairwise so tolerance is not transitive across 3+ candidates (cannot produce a wrong verdict at these tolerances).
