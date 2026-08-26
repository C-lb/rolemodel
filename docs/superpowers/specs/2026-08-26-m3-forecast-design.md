# M3 — Forecast, Scenarios, Sensitivity — Design Spec

**Parent spec:** `2026-08-25-financial-modelling-webapp-design.md`
**Depends on:** M1 (canonical statements, provenance, validation gate), M2 (ratio engine, expression parser)

## 1. Goal

From the historical statements M1 extracted, project a linked three-statement forecast
driven by explicit assumptions. The user edits drivers, not cells. Scenarios hold
independent driver sets. A two-variable sensitivity grid re-runs the whole forecast across
a range of two drivers and reports a chosen output.

The property that carries M1 and M2 forward: every forecast number is explainable. Not by
provenance to a document, because there is no document, but by the driver and the prior
period balance it came from. A forecast cell can always answer "which assumption moved
this".

## 2. Decisions taken

These four were decided before the spec was written and are not open questions.

**Acyclic evaluation on beginning balances.** Interest is computed on the opening debt and
opening cash of each period, never on the average. The dependency graph is therefore a
strict topological order with no circularity, no iterative solver, and no convergence
failure mode. Cycle detection stays a hard error rather than a signal to start iterating.
The cost is that interest is understated slightly in a year of heavy borrowing and
overstated in a year of heavy repayment. That is a documented, defensible convention, and
it buys a model where every cell has one evaluation and one explanation.

**Cash plus revolver plug.** A forecast balance sheet does not close on its own. Surplus
cash accumulates on the balance sheet; a shortfall below a minimum-cash floor draws a
revolver. This introduces one new line item, `revolver`, which is visible on the balance
sheet and in the financing section of the cash-flow statement. Nothing is hidden inside a
subtotal.

**Scenarios are arbitrary, seeded with three.** Base is created with the workspace's first
forecast, cannot be deleted, and is seeded from history. Bull and Bear are seeded as
ordinary editable scenarios with documented nudges applied. There is no special-case code
for the three names; the only privileged flag is `isBase`.

**Five annual periods, adjustable one to five.** Forecast periods are always `FY`, derived
by extending the latest historical `FY`. A workspace whose most recent period is quarterly
cannot be forecast, and says so with a named reason rather than guessing an annualisation.

## 3. Forecast periods

`extendAnnualPeriods(latest: string, count: number): string[]` lives in the existing
`src/model/periods.ts` so there is one module that knows what a period key is.

- `latest` must match `/^FY\d{4}$/`. Anything else returns an empty list, and the caller
  surfaces the refusal.
- Returns `count` keys ascending from `latest + 1`, so `extendAnnualPeriods("FY2024", 3)`
  is `["FY2025", "FY2026", "FY2027"]`.
- `count` is clamped to 1..5.

Forecast keys sort above historical keys under the existing `periodRank`, so the workspace
period list stays "most recent first" with no new ordering rule. The forecast view displays
historicals oldest-to-newest on the left and forecasts to the right, which is a display
concern only.

## 4. Drivers

A driver is one assumption, scoped to one scenario and one forecast period. Every driver
exists for every forecast period from the moment a scenario is created, so there is no
"unset means inherit" rule to reason about. Seventeen drivers:

| Key | Unit | Applies to |
|---|---|---|
| `revenue_growth` | percent | Revenue against the prior period |
| `gross_margin` | percent | Gross profit as a share of revenue |
| `rd_pct_revenue` | percent | Research and development |
| `sga_pct_revenue` | percent | Selling, general and administrative |
| `sbc_pct_revenue` | percent | Stock-based compensation |
| `other_income_expense` | currency | Held flat, plus interest earned on opening cash |
| `dso` | days | Accounts receivable against revenue |
| `dio` | days | Inventory against cost of revenue |
| `dpo` | days | Accounts payable against cost of revenue |
| `capex_pct_revenue` | percent | Capital expenditures |
| `depreciation_pct_ppe` | percent | Depreciation against opening PP&E |
| `tax_rate` | percent | Tax on positive pre-tax income |
| `dividend_payout` | percent | Dividends as a share of positive net income |
| `interest_rate_debt` | percent | Interest on opening total debt including revolver |
| `interest_rate_cash` | percent | Interest earned on opening cash |
| `debt_repayment` | currency | Scheduled repayment of long-term debt, positive means repay |
| `min_cash` | currency | The floor the revolver defends |

### 4.1 Seeding from history

`deriveDrivers(history)` produces a starting value for each driver from the most recent
historical period, and records where it came from:

```ts
type DriverBasis = "derived" | "default";
interface SeededDriver { key: string; value: number; basis: DriverBasis; note: string }
```

- `revenue_growth` is the last period-over-period growth rate, using
  `isImmediatePredecessor` so it is never computed across a gap.
- Margin and percent-of-revenue drivers are the last actual ratio, over the MAGNITUDE of the
  cost line: `gross_margin` is `(revenue - |cost_of_revenue|) / revenue`.
- `dso` is `accounts_receivable / revenue * 365`, `dio` is `inventory / |cost_of_revenue| * 365`,
  `dpo` is `accounts_payable / |cost_of_revenue| * 365`.
- `depreciation_pct_ppe` is `depreciation_amortisation / property_plant_equipment` of the
  same period, because there is no earlier PP&E balance to open from at the seam.
- `tax_rate` is `|income_tax_expense| / pretax_income`, clamped to 0..0.5, and falls back
  when pre-tax income is not positive so a loss never derives a rate.
- `interest_rate_debt` is `|interest_expense| / total opening debt`, clamped to 0..0.25.
- `capex_pct_revenue` is `|capital_expenditures| / revenue`.

**Every cost-line derivation takes a magnitude, and none assumes a stored sign.** This mirrors
§5.1's output-side rule and was corrected during implementation, late. The original text here
assumed costs were stored negative, so a filing that printed them positive seeded a gross margin
of 1.6 — 160 percent — silently, marked `derived`, with a confident note. `capex_pct_revenue`
had no plausibility clamp either, so it would equally have derived a negative capital-expenditure
rate. The guards that must survive any future edit here: a loss falls back rather than deriving,
and net figures are never magnitude-ed.
- `min_cash` defaults to the last historical cash balance, so a freshly seeded Base draws
  no revolver in period one unless the business actually burns cash.
- `other_income_expense` is the last historical value. "Held flat" in §4's table means flat at
  the last actual, not flat at zero.
- `dividend_payout` is `|dividends_paid| / net_income`, clamped 0..1. Added during
  implementation: the constants below are a fallback clause, not a prohibition on deriving, and
  this driver had no derivation rule only because the list overlooked it. Zeroing a dividend
  payer's distributions overstates forecast cash in every period, and that error flows straight
  into the cash plug and the revolver draw.

`interest_rate_cash` and `debt_repayment` are the two drivers with no honest derivation.
Interest income is embedded inside `other_income_expense` and is never separately reported, and
`debt_issued_repaid` is a net figure whose split into issuance and repayment would be guesswork.
Both seed from their constants, and their notes say why.

Where an input is missing, zero, or produces a value outside its clamp, the driver falls
back to a documented constant with `basis: "default"` and a note saying why. The defaults
are: growth 0.03, tax rate 0.21, `interest_rate_cash` 0.02, `dividend_payout` 0,
`debt_repayment` 0, and zero for every remaining percent-of-revenue driver.

Seeded values are written once, at scenario creation. They are ordinary editable rows from
then on. Re-seeding is an explicit user action that overwrites, never a silent refresh.

**The re-seed action, and what happens until it is used.** Amended at the final review, which
found the promise above had no implementation. Driver rows are written against the forecast
periods the then-latest historical year implied, and section 5's period list is recomputed from the
CURRENT latest, so uploading a later filing into a workspace that already has scenarios leaves the
last forecast period with no driver rows at all. The engine fell back to the documented
constants for every one of them and returned `ok: true`: a rendered forecast, with a zero gross
margin, and a driver grid showing `0.00%` where the engine had used 0.03.

- `reseedScenario(workspaceId, scenarioId)` re-derives from the current history and overwrites
  every driver row in the scenario, for the periods the current history implies. It is bound to a
  button. It does not re-apply section 4.2's Bull and Bear nudges, because there is no privileged
  flag but `isBase` to read them back off a name (section 2); the control says it overwrites and
  offers duplicating first.
- Until it is used, the forecast is REFUSED, not filled. Filling the gap at assembly time is a
  silent refresh performed once per page load, which this section rules out. The refusal is
  `forecast_drivers_missing`, blocking, naming the periods.

### 4.2 Scenario seeding

- **Base** takes the seeded values unchanged.
- **Bull** takes Base with `revenue_growth` plus 300 basis points and `gross_margin` plus
  100 basis points, in every forecast period.
- **Bear** takes Base with the same two nudges applied downward, and `gross_margin` floored
  at zero.

These are starting points chosen to be obviously arbitrary rather than falsely precise. The
UI says so.

## 5. The engine

`runForecast(input): ForecastResult` in `src/model/forecast/engine.ts`. Pure: no React, no
database, no I/O, covered by the existing purity guard.

Input is the historical value resolver, the ordered historical period list, the forecast
period list, and the driver values keyed by period. Output is a value for every taxonomy
key in every forecast period, plus per-period plug detail and any findings.

Periods evaluate in order. Within a period, `P` is the prior period, historical for the
first forecast period, and every balance-sheet reference to `P` is an opening balance.

### 5.1 Income statement

```
revenue                = revenue[P] * (1 + revenue_growth)
cost_of_revenue        = -(revenue * (1 - gross_margin))
gross_profit           = revenue + cost_of_revenue
research_development   = -(revenue * rd_pct_revenue)
selling_general_admin  = -(revenue * sga_pct_revenue)
operating_expenses     = research_development + selling_general_admin
operating_income       = gross_profit + operating_expenses
interest_expense       = -(openingDebt * interest_rate_debt)
other_income_expense   = other_income_expense_driver + cash[P] * interest_rate_cash
pretax_income          = operating_income + interest_expense + other_income_expense
income_tax_expense     = -(max(pretax_income, 0) * tax_rate)
net_income             = pretax_income + income_tax_expense
```

`openingDebt` is `short_term_debt[P] + long_term_debt[P] + revolver[P]`.

The formulas above are written in the negative-cost convention, and the engine's internal
arithmetic uses it throughout: `gross_profit = revenue + cost_of_revenue` only works that way.

**But the stored sign is observed, not assumed.** `src/extract/prompt.ts` tells the model that
costs and outflows keep the sign the document uses, so the convention genuinely varies by
filing — `MAGNITUDE_KEYS` in the ratio engine exists to absorb exactly that. A forecast that
hardcoded a negative sign would render `+6000, +6000, -7800` across the history/forecast seam
for any filing that prints costs positive.

So the engine applies a sign only as it writes each cell: `historicalSign(key)` reads the last
historical non-zero value for that key and matches it, falling back to the convention above when
history has none. Most recent non-zero wins; signs are never averaged across periods.

**Income-statement cost lines only**: `cost_of_revenue`, `interest_expense`,
`income_tax_expense`, `research_development` and `selling_general_admin`. Cash-flow lines are
never re-signed.

That split is not arbitrary. Income-statement parents subtract, so a costs-positive statement
foots: `operating_income = 484 - 181.5` with `operating_expenses` shown positive is exactly how
such a filing prints. The cash-flow statement aggregates by addition, and a signed cash effect is
its semantics — there is no presentation convention in which `+96.8` of capital expenditure adds
up. An earlier revision of this section included `capital_expenditures` and `dividends_paid`, and
a costs-positive fixture then produced a cash-flow statement whose sections summed to 448.1
against a bottom line of 152.9, reading as though investing and financing generated cash in a
year of capex, repayment and dividends.

`debt_issued_repaid` and `other_income_expense` are excluded for a different reason: both are net
figures that can legitimately take either sign, so there is no convention to observe. The forecast must not invent a second sign
convention, and a test asserts the forecast's sign for each of `cost_of_revenue`,
`interest_expense`, `income_tax_expense`, `capital_expenditures` and `dividends_paid`
matches the sign of the same key in the last historical period.

Two stated simplifications, both surfaced as tooltips in the UI:

- **Depreciation is a cash-flow addback only.** The taxonomy carries
  `depreciation_amortisation` on the cash-flow statement and nowhere on the income
  statement, so depreciation is already inside cost of revenue and operating expenses by
  construction. The engine does not subtract it again.
- **Losses carry no tax benefit.** Tax is levied on positive pre-tax income only. There is
  no net operating loss carryforward. A loss year shows zero tax rather than a credit.

### 5.2 Working capital and the cash-flow statement

```
accounts_receivable = dso / 365 * revenue
inventory           = dio / 365 * |cost_of_revenue|
accounts_payable    = dpo / 365 * |cost_of_revenue|

deltaWC                    = (AR - AR[P]) + (Inv - Inv[P]) - (AP - AP[P])
change_in_working_capital  = -deltaWC
depreciation_amortisation  = property_plant_equipment[P] * depreciation_pct_ppe
stock_based_compensation   = revenue * sbc_pct_revenue
cash_from_operations       = net_income + D&A + SBC + change_in_working_capital

capital_expenditures  = -(revenue * capex_pct_revenue)
acquisitions          = 0
other_investing       = 0
cash_from_investing   = capital_expenditures + acquisitions + other_investing

debt_issued_repaid           = -debt_repayment
dividends_paid               = -(max(net_income, 0) * dividend_payout)
equity_issued_repurchased    = 0
other_financing              = 0
```

`acquisitions`, `other_investing`, `equity_issued_repurchased` and `other_financing` are
held at zero rather than at their last historical value. A one-off acquisition repeated
every forecast year is a worse default than none, and the user has no driver to switch it
off. The UI labels these rows as held at zero.

### 5.3 The plug

```
preplugFinancing = debt_issued_repaid + dividends_paid
preplugChange    = cash_from_operations + cash_from_investing + preplugFinancing
cashBeforePlug   = cash[P] + preplugChange

if cashBeforePlug < min_cash:
    draw     = min_cash - cashBeforePlug
    revolver = revolver[P] + draw
    cash     = min_cash
else:
    surplus  = cashBeforePlug - min_cash
    repaid   = min(surplus, revolver[P])
    revolver = revolver[P] - repaid
    cash     = cashBeforePlug - repaid

revolver_movement   = revolver - revolver[P]
cash_from_financing = preplugFinancing + revolver_movement
net_change_in_cash  = cash_from_operations + cash_from_investing + cash_from_financing
fx_effect_on_cash   = 0
```

`revolver_movement` is a real cash-flow line item in the taxonomy, sitting under
`cash_from_financing` between `debt_issued_repaid` and `equity_issued_repurchased`, and flagged
`absentMeansZero` exactly as `revolver` is. It was added during implementation: without it,
`cash_from_financing` was the one subtotal in the model that did not equal the sum of its
components, which contradicted §2's promise that the revolver is visible in the financing
section and that nothing is hidden inside a subtotal.

The revolver repays before cash accumulates above the floor, which is the behaviour a
banker expects and the only ordering that keeps a surplus period from carrying idle debt.
`cash[P] + net_change_in_cash` must equal the plugged cash; the engine asserts this and emits a
finding if it ever fails, because a mismatch means the statement
articulation is broken rather than the forecast being pessimistic.

### 5.4 Balance sheet

Held flat at the opening balance: `short_term_investments`, `other_current_assets`,
`goodwill`, `intangible_assets`, `other_noncurrent_assets`, `accrued_liabilities`,
`deferred_revenue_current`, `other_current_liabilities`, `short_term_debt`,
`other_noncurrent_liabilities`, `treasury_stock`, `accumulated_oci`.

Rolled forward:

```
cash_and_equivalents      = from the plug
property_plant_equipment  = PPE[P] + |capital_expenditures| - depreciation_amortisation
revolver                  = from the plug
long_term_debt            = max(long_term_debt[P] - debt_repayment, 0)
common_stock_apic         = common_stock_apic[P] + stock_based_compensation
retained_earnings         = retained_earnings[P] + net_income + dividends_paid
```

Subtotals are summed from their taxonomy components, never carried forward independently.

### 5.5 The articulation invariant

The construction above closes exactly. Assets change by cash, receivables, inventory and
PP&E; liabilities and equity change by payables, the revolver, scheduled repayment,
stock-based compensation, net income and dividends. Substituting the cash-flow identity
into the first collapses it to the second, with capital expenditure and depreciation
cancelling against the PP&E roll-forward and the working-capital delta cancelling against
the receivable, inventory and payable movements.

That is not a comment, it is a test. For every forecast period the engine checks
`total_assets` against `total_liabilities + total_equity`.

**Not under `closeEnough`.** This is an algebraic identity, not two independently rounded figures
being compared, so the only residual is floating-point noise. `closeEnough` allows
`max(1, 0.005 x scale)`, which is roughly 8.6 on a 1,500-unit balance sheet — wide enough that
the guard's sensitivity is set by the size of the test fixture rather than by the engine. During
implementation a deliberate mutation that dropped the working-capital delta from cash from
operations passed at one fixture size and failed at another, which is the symptom.

The invariant uses its own comparator, `max(1e-6, scale x 1e-9)`, and so do the hand-computed
fixture literals, which are exact and were being checked at half a percent. The precedent is M2,
which introduced `ratiosAgree` rather than reuse `closeEnough` for the DuPont check for the same
class of reason. The test
suite must include a mutation check in the spirit of the project's existing guard tests: a
deliberately broken engine, for instance one that drops the working-capital delta from cash
from operations, must make the invariant test fail. A guard that has never been seen to go
red cannot be trusted.

That check is committed, in `engine.mutation.test.ts`. It applies a textual mutation to
`engine.ts`'s own source, compiles it in memory with the real dependencies injected, and runs the
mutant through the real fixtures — so the invariant that goes red is the engine's, not a
reimplementation of it. Each mutation asserts it actually changed the source, so an edit to
`engine.ts` that moves the mutated line turns the guard red rather than quietly making it vacuous.
Three of the four known mutations break articulation. The fourth, depreciation on a base other
than opening PP&E, provably does not: depreciation is an operating addback, so the extra charge
adds to cash exactly what it removes from PP&E. The check asserts that blindness explicitly and
names the dedicated opening-balance test as the guard that does catch it.

### 5.6 Findings

The engine returns structured findings rather than throwing, matching the `Finding` shape
M1's validation gate already uses:

| Code | Severity | Meaning |
|---|---|---|
| `forecast_not_annual` | blocking | Latest historical period is not an `FY` key |
| `forecast_missing_base` | blocking | A line item the engine needs has no opening value |
| `forecast_articulation_broken` | blocking | The balance check failed, which is an engine bug |
| `forecast_revolver_drawn` | warning | The revolver was drawn in at least one period |
| `forecast_equity_negative` | warning | Total equity fell below zero |
| `forecast_driver_default` | info | At least one driver is a fallback constant, not derived |
| `forecast_drivers_missing` | blocking | A forecast period has no driver rows: the scenario predates the current history (section 4.1) |
| `forecast_driver_implausible` | blocking | A driver is outside any range the forecast can be computed over |

The last two were added at the final review. `forecast_driver_implausible` exists because
`revenue_growth: -1e6` and `tax_rate: 1e300` are typeable, and both previously came back as
`forecast_articulation_broken`, whose remediation reads "This is a defect in the forecast engine,
not in the assumptions. Report it." It was the assumptions. The bounds are per unit and
deliberately far outside any real model: 1000 per cent, 3650 days, 1e12 of currency.

A blocking finding means the forecast columns are not shown as numbers. It never means a
half-populated grid.

## 6. New line item: `revolver`

Added to the taxonomy on the balance sheet, in current liabilities, ordered between
`short_term_debt` and `other_current_liabilities`.

Historical documents will never produce a `revolver` fact, so the cell is absent in every
historical period and the existing subtotal validation, which sums the components it can
see, is unaffected. A test asserts that adding the item does not change any M1 validation
finding on the existing fixtures.

The M2 ratio library's debt expressions gain `revolver`: `debt_to_equity`,
`net_debt_to_ebitda`, and every other expression that currently sums `short_term_debt` and
`long_term_debt`. A forecast that has drawn a revolver would otherwise show leverage that
quietly excludes its own borrowing.

**Corrected during implementation.** This section originally claimed historical results were
unchanged because the term is always absent there. That was wrong. An absent identifier does
not drop out of a sum in the M2 evaluator; it makes the whole ratio `unavailable`. Adding
`revolver` to the debt expressions would therefore have flipped every historical debt ratio
from `ok` to `unavailable`.

The fix is a `absentMeansZero` flag on `LineItemDef`, set on `revolver` alone: a line item the
extractor can never emit, whose absence means the concept does not apply rather than that
extraction missed it. It is set on `revolver` and on `revolver_movement`, the cash-flow line
introduced in §5.3, and on nothing else. The flag lives on the taxonomy entry, not in a list
beside the ratio library, so the property is declared where the line item is and a key that can legitimately be
absent-because-unextracted cannot be added to it by accident. The averaging path skips such a
key rather than treating the asserted zero as a fallback, which would otherwise stamp a
spurious `averaging_fallback` note on every averaged debt ratio.

## 7. Ratios over forecast periods

`computeRatios` takes a `WorkspaceView`, not a period list and a resolver. The ratios view
therefore gains forecast columns through a forecast layer on `buildWorkspace`:
`forecast?: { periods: string[]; valueAt: ValueLookup }`. A cell whose period is in the layer
resolves from it and reports `source: "forecast"`, with no provenance, no extracted value and
no confidence. An override never shadows a forecast cell.

Threading the forecast through the workspace rather than around it means ratios over forecast
periods, the sensitivity output metric, and the non-editable forecast statement all fall out of
the seam M1 already built. The computation engine changes only for the `absentMeansZero` rule
in §6.

M1's validation gate does not run over forecast periods. Its balance-sheet, cash-flow-tie and
subtotal checks describe extracted data; a computed column has the forecast engine's own
`forecast_*` findings instead.

Two constraints:

- Generated interpretation stays historical-only in M3. The prompt is grounded in observed
  numbers, and a forecast is not an observation. The card says so.
- A ratio spanning the historical-to-forecast seam, an average-balance ratio in the first
  forecast period, opens from the last historical balance. That is correct and needs no
  special case, but it is worth a test.

## 8. Sensitivity

`sensitivityGrid(input): SensitivityResult` in `src/model/forecast/sensitivity.ts`.

Input: the forecast input, two driver keys, a min, max and step count for each, an output
metric, and an output period.

- Step count is 3, 5 or 7 per axis. The maximum grid is therefore 49 evaluations, which is
  a few milliseconds of pure arithmetic and needs no memoisation or worker.
- Axis values are evenly spaced from min to max inclusive.
- Each cell clones the active scenario's drivers, sets both axis drivers to the cell's
  values in every forecast period, re-runs the forecast, and reads the output.
- The output metric is a taxonomy key, a built-in ratio key, or a custom ratio key. Ratio
  outputs reuse `computeRatios`, so a cell whose ratio is undefined reports the ratio
  engine's own named state rather than a blank or a `NaN`.
- A cell whose forecast produced a blocking finding reports `failed` with the finding code.
- The base case, the cell matching the scenario's current driver values, is flagged so the
  UI can mark it. It is only present when the current value happens to fall on an axis
  step; the flag is per-cell, not an assumption that the centre cell is the base.

## 9. Data model additions

```
scenarios   id, workspaceId, name, isBase, ordinal, createdAt
drivers     id, scenarioId, key, periodKey, value, basis, note, updatedAt
workspaces  + forecastHorizon (integer, default 5)
            + activeScenarioId (nullable, set null on scenario delete)
```

- `scenarios` has a unique index on `(workspaceId, name)` and an index on `workspaceId`.
- `drivers` has a unique index on `(scenarioId, key, periodKey)` and cascades on scenario
  delete.
- Deleting the base scenario is refused at the server layer, not by a database constraint,
  so the refusal can carry a message.
- Changing `forecastHorizon` upward seeds drivers for the new periods from the last
  existing forecast period of each scenario. Changing it downward deletes the driver rows
  beyond the new horizon. Both are explicit, and the UI warns before the downward case.

Migrations are idempotent DDL appended to the `DDL` array in `src/db/client.ts`. The two
new `workspaces` columns are guarded `ALTER TABLE` statements, because
`CREATE TABLE IF NOT EXISTS` will not add a column to a database that already exists.

## 10. UI

A third tab in the workspace, alongside Statements and Ratios.

**Scenario bar.** Tabs for each scenario, with the active one selected. Add, rename,
duplicate, delete. Base is marked and its delete control is absent rather than disabled
without explanation. A horizon control of one to five periods sits at the right.

**Driver grid.** Rows are drivers, columns are forecast periods, cells are editable inputs
reusing `EditableCell` from M1 so the editing behaviour, keyboard handling and validation
messages are the ones the user already knows. Percent drivers display as percentages and
store as decimals. A driver still on its seeded value shows a subtle marker with a tooltip
saying whether it was derived from history or is a fallback constant, and which. A
fill-right control copies a period's value across the remaining periods, because typing the
same growth rate five times is the first thing anyone will complain about.

**Forecast statements.** The three statements with historical columns and forecast columns,
visually separated at the seam. Forecast cells are not editable: the driver is the edit
surface, and allowing a direct override on a computed cell would break the articulation
invariant that everything else rests on. Clicking a forecast cell opens a panel showing the
formula that produced it, the driver values it consumed, and the opening balances it read,
which is the forecast's answer to M1's provenance panel. Held-flat and held-at-zero rows
are labelled as such.

**Sensitivity.** Two driver pickers with min, max and step controls, an output metric
picker, an output period picker, and the resulting grid. Cells are shaded by value on a
diverging scale relative to the base case, with the shading readable without colour alone,
since a two-variable grid read only by hue is unusable for a large share of readers. The
base case cell is outlined. Failed cells show their reason.

Every new control gets an entry in the existing tooltip registry, whose completeness test
already fails on a missing entry.

## 11. Testing

- **Engine:** a hand-verified three-statement fixture with known forecast answers for two
  periods, computed independently. Every rule in section 5 gets a test that fails when the
  rule is removed. The articulation invariant is mutation-tested.
- **Plug:** a surplus case, a deficit case, a case that draws and then repays, and a case
  where the surplus is smaller than the outstanding revolver.
- **Drivers:** seeding from a complete history, from a history missing each input in turn,
  and from a history whose most recent two periods are not adjacent.
- **Periods:** annual extension, the quarterly refusal, and horizon clamping.
- **Sensitivity:** grid shape and axis spacing, a known analytic result on a simple output,
  a cell that fails, and the base-case flag.
- **Persistence:** scenario CRUD including the base-delete refusal, driver upsert, horizon
  change in both directions.
- **UI:** driver edit dispatches, forecast cells are not editable, scenario switch changes
  the numbers.
- **Browser:** a Playwright pass over the forecast view against the seeded database. M2
  established that jsdom will pass a drag surface that is dead in a real browser, so the
  driver grid's fill-right control and the scenario tabs are walked in Chrome.

## 12. Out of scope for M3

- Discounted cash-flow valuation, terminal value, WACC. Deferred to a candidate M6, as the
  parent spec states.
- Quarterly forecasts.
- Direct overrides on forecast cells.
- Net operating loss carryforwards, deferred tax, minority interest, equity method
  investments.
- Generated interpretation of forecast numbers.
- Multi-scenario comparison charts. One scenario is displayed at a time; comparison is M4's
  report problem.

## 13. Assumptions flagged for review

- Interest on beginning balances rather than average balances is a real modelling choice
  with a real cost. It is taken deliberately to keep the graph acyclic, and it should be
  revisited if a user complains that the numbers do not tie to their own model.
- Holding acquisitions and share repurchases at zero will look wrong for a serial acquirer
  or a company with a standing buyback. The alternative, repeating last year's one-off
  forever, looked worse. If this proves annoying, the fix is two more drivers, not a
  different architecture.
