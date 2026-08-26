# M3 decision log — forecast, scenarios, sensitivity

Spec: `docs/superpowers/specs/2026-08-26-m3-forecast-design.md`
Plan: `docs/superpowers/plans/2026-08-26-m3-forecast.md`

## The four decisions taken before the spec was written

These are recorded in spec §2 as settled, not open questions. They are repeated here with
what each costs, because that cost is what a future milestone would be weighing if it
proposed changing one.

**Acyclic evaluation on beginning balances.** Interest each period is computed on the
opening debt and opening cash, never the average. This makes the dependency graph a strict
topological order — no circularity, no iterative solver, no convergence failure mode. Every
cell has exactly one evaluation and one explanation. Cost: interest is understated in a year
of heavy borrowing and overstated in a year of heavy repayment. Worth revisiting only if the
model needs to forecast a business whose debt swings large enough within a single year that
this understatement or overstatement materially changes the plug or the revolver draw —
at that point an average-balance or iterative solver becomes worth its complexity.

**Cash plus revolver plug.** A forecast balance sheet does not close on its own. Surplus
cash accumulates; a shortfall below a minimum-cash floor (`min_cash`) draws a revolver. The
revolver is a real line item, visible on the balance sheet and in the financing section of
the cash-flow statement — nothing is hidden inside a subtotal. Cost: one more line item that
is zero for any company that never draws. Worth revisiting only if a future milestone needs
more than one financing instrument to plug with (e.g. drawing a term loan before a revolver,
or multiple revolver tranches at different rates) — the current plug logic assumes exactly
one facility.

**Scenarios are arbitrary, seeded with three.** Base is created with the workspace's first
forecast, cannot be deleted, and is seeded from history. Bull and Bear are ordinary editable
scenarios seeded with documented nudges. The only privileged flag is `isBase`; there is no
special-case code keyed on scenario name. Cost: none identified — this is the cheaper design
in both directions (arbitrary scenarios were needed anyway for the sensitivity grid to make
sense). Worth revisiting only if a future need arises for scenario-level metadata beyond a
name and driver set (e.g. probability weighting across scenarios for an expected-value
view).

**Five annual periods, adjustable one to five.** Forecast periods are always `FY`, extending
the latest historical `FY`. A workspace whose most recent period is quarterly cannot be
forecast, and says so with a named reason (`forecast_missing_base` and related findings)
rather than guessing an annualisation. Cost: a workspace with only quarterly history cannot
forecast at all until it has a full fiscal year on record. Worth revisiting if quarterly
forecasting becomes a real product need — it would need its own annualisation convention,
which the spec deliberately avoided guessing at.

## Decisions the implementation forced

The four decisions above were the plan going in. The following were not anticipated by the
spec and were resolved during execution. Several are corrections to the spec itself, made
because the spec's original text was factually wrong about what the codebase would do.

**`revolver` needed its own absent-means-zero taxonomy flag.** Adding `revolver` to the debt
ratios' expressions would have flipped every historical debt ratio from `ok` to
`unavailable`, because the ratio engine's rule is that an absent line item makes the whole
ratio unavailable rather than dropping out of the sum — and `revolver` is never extracted
from a real filing, so it is always absent in history. Resolved by adding
`LineItemDef.absentMeansZero`, set on `revolver` alone: an absent-and-flagged key reads as 0
in a ratio rather than voiding it. The same flag is also used to filter `revolver` out of
the extraction prompt's taxonomy list, since a filing that reports a drawn revolver should
map it to `short_term_debt` or `long_term_debt`, not to a key the model is told it can never
see.

**The articulation invariant needed its own tight comparator.** The shared `closeEnough`
tolerance is wide enough (roughly ±8.6 on a 1503 balance sheet) that it was being armed by
fixture size rather than by the engine: a deliberate mutation passed undetected at 10%
fixture growth and only failed once growth was raised to 30%. The balance sheet closes
exactly by construction, so the only legitimate residual is float noise. The invariant and
the hand-computed fixture literals now use a comparator of `max(1e-6, scale * 1e-9)`,
matching the precedent set by M2's `ratiosAgree`.

**`revolver_movement` became a real cash-flow line.** Spec §2 promised the revolver would be
visible "in the financing section of the cash-flow statement" with nothing hidden inside a
subtotal, but the taxonomy as first implemented gave the revolver no cash-flow line at all.
`cash_from_financing` was, as a result, the only subtotal in the whole model not equal to the
sum of its own taxonomy components — and the test that would have caught this special-cased
the anomaly instead of catching it. `revolver_movement` now exists as its own
`absentMeansZero` line under `cash_from_financing`.

**Signs are observed from history, not assumed — but only on income-statement cost lines.**
The extraction prompt lets a filing's own sign convention win, so `cost_of_revenue`,
`interest_expense`, `income_tax_expense`, `research_development` and
`selling_general_admin` can be stored positive or negative depending on the document. The
forecast engine originally hardcoded the negative convention from spec §5.1. That was wrong
for any positive-cost filing, so the engine now observes each key's sign from the most
recent historical value it can find and writes forecast cells consistently with it.

The first attempt at this fix applied the observed sign too broadly — to all seven flagged
keys, including `capital_expenditures` and `dividends_paid`. On the positive-cost fixture
this produced a cash-flow statement whose sections summed to 448.1 against a shown
`net_change_in_cash` of 152.9, as if investing and financing activity had generated cash in
a year of capex, debt repayment and dividends. The reason: income-statement parents
subtract, so a costs-positive statement still foots correctly, but the cash-flow statement
aggregates by addition, where a line's sign IS its cash effect — no convention makes +96.8
of capex add up. The observed-sign treatment is now scoped to income-statement cost lines
only. The gap that let the first version ship green was that the subtotal-equals-its-children
test only iterates subtotals that have taxonomy children; `net_change_in_cash` and the other
parentless subtotals (CFO, CFI, CFF, fx) were never checked, so nothing caught the mismatch.
The fix round added a direct bottom-line assertion and a completeness sweep for any other
parentless subtotal.

**Seeding had the mirror-image sign bug, for longer.** Everything above concerns cells the
engine *writes*. Seeding — deriving a driver's starting value from history — has a symmetric
problem on the *read* side, and it was not caught until Task 8, well after the engine's own
sign handling had been fixed. `src/model/forecast/seed.ts` hardcoded the assumption that
costs are stored negative in every cost-line derivation. Against the positive-stored costs
in M2's own ratio fixture, `deriveGrossMargin` computed `(revenue + cost_of_revenue) /
revenue` and produced 1.6 — a 160% gross margin — silently, with basis `derived` and a
confident note. Verified directly: 15,000 revenue and 9,000 cost of revenue should be a 0.4
margin and yielded 1.6. Five more derivations carried the identical assumption
(`capex_pct_revenue`, `daysOf`, `tax_rate`, `interest_rate_debt`, `dividend_payout`); those
five degrade to a clamp fallback rather than an inverted-looking-plausible number, which is
why the bug was visible only in gross margin. The fix derives from magnitudes rather than an
assumed stored sign, mirroring the engine-side fix exactly. The required regression is that
both sign conventions produce the same driver values — every existing seed test used only a
negative-cost fixture, which is exactly why the bug shipped in the first place. Loss-making
guards (`deriveTaxRate` falling back when pretax income is not positive,
`deriveDividendPayout` falling back when net income is not positive) were verified to
survive the fix and still precede the magnitude arithmetic, so a loss-making company still
gets an honest fallback rather than a fabricated positive rate.

## Two items worth disclosing plainly

**Commit `a6ff9e7`'s message is wrong.** It reads "stop WorkspaceScreen tests leaking state
between runs." That describes the working hypothesis at the time, not the actual fix. The
root cause was a production race in the retry path: React's `useTransition` only flips
`isPending` back to `false` on the render *after* the transition's async callback settles,
one render later than the `setSaveFailure` call inside that same callback. A failed save
therefore had a genuine intermediate render where the failure banner was showing and the
retry button was not, because the retry button was gated on `isPending`. This was found by
refusing to accept the failure as "pre-existing, unrelated" when it recurred a third time
during M3, reproducing it deliberately under `vitest --sequence.shuffle` rather than
shrugging at an order-dependent flake. The fix adds a dedicated `saving` state flipped
synchronously in the same continuation as `setSaveFailure`, and was verified across 18
shuffled full-suite runs with no recurrence. The commit message was not amended, because
amending it would mean rewriting already-pushed history on `main`, and this repo's standing
practice is to never do that. This paragraph is the correction that the commit message
itself does not carry.

**The e2e sensitivity test was built around the 160% gross margin bug, not against it.**
Before the bug above was found and fixed, `e2e/forecast.spec.ts` set the sensitivity grid's
column axis to 1.5 / 1.6 / 1.7 specifically so the buggy 1.6 value would land on the axis,
with a comment calling it "a pre-existing fixture quirk, not something this test is asserting
is correct." Someone had already noticed the 160% margin, correctly identified it as
suspicious, and then explained it away rather than investigating it. The bug then survived
for the rest of that task's execution because the explanation stood in for a fix. It was
caught only when a later implementer report mentioned the number in passing and the
controller chose to trace it rather than accept it as before. The lesson worth keeping past
this milestone: a comment that names a number as wrong and then works around it is not a
disclosure, it's a place the investigation stopped short. Once the underlying seeding bug was
fixed, the axis was re-centred on the correct 0.4 and the comment was deleted rather than
updated, since there is no longer anything to explain away.
