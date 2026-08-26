# M2 — Ratios and Interpretation — Design Spec

Date: 2026-08-25
Status: approved for planning
Parent spec: `docs/superpowers/specs/2026-08-25-financial-modelling-webapp-design.md` §7, §11

## 1. Goal

From the canonical statements M1 produces, compute a built-in library of 25 ratios across
five families, show each one's trend across the extracted periods, let the user build
custom ratios by dragging line items, and attach two kinds of explanation: authored
definitional text that never changes, and an on-demand generated read of what the numbers
actually did.

A ratio is only as trustworthy as its inputs, so every ratio card can show the exact
component values that produced it and inherits the warnings attached to those cells.

## 2. Decisions taken

| Question | Decision |
|---|---|
| Library size | Ship all 25. A focus toggle narrows the view to a core 12. |
| Balance-sheet denominators | Workspace toggle, default `average`. |
| Situational interpretation | On demand per card, cached against an input hash. |
| Custom ratio expressiveness | Safe expression AST: identifiers, numbers, `+ - * /`, parentheses, unary minus. No functions, no `eval`. |

## 3. The ratio library

Every formula below uses canonical keys from `src/model/taxonomy.ts`. Nothing here needs a
taxonomy extension, which is why per-share and valuation multiples are excluded (§10).

`EBITDA` is shorthand for `operating_income + depreciation_amortisation`.
`total_debt` is shorthand for `short_term_debt + long_term_debt`.

Core 12 members are marked `*`. `Unit` drives formatting: `x` renders `1.84x`, `%` renders
`38.2%`, `days` renders `47 days`, `ccy` renders as money.

### Liquidity

| Key | Formula | Unit | Better |
|---|---|---|---|
| `current_ratio` * | `total_current_assets / total_current_liabilities` | x | higher |
| `quick_ratio` * | `(cash_and_equivalents + short_term_investments + accounts_receivable) / total_current_liabilities` | x | higher |
| `cash_ratio` | `(cash_and_equivalents + short_term_investments) / total_current_liabilities` | x | higher |
| `working_capital` | `total_current_assets - total_current_liabilities` | ccy | higher |
| `ocf_to_current_liabilities` | `cash_from_operations / total_current_liabilities` | x | higher |

### Leverage

| Key | Formula | Unit | Better |
|---|---|---|---|
| `debt_to_equity` * | `total_debt / total_equity` | x | lower |
| `debt_to_assets` | `total_debt / total_assets` | % | lower |
| `liabilities_to_equity` | `total_liabilities / total_equity` | x | lower |
| `equity_multiplier` | `total_assets / total_equity` | x | context |
| `net_debt_to_ebitda` | `(total_debt - cash_and_equivalents - short_term_investments) / EBITDA` | x | lower |

### Efficiency

| Key | Formula | Unit | Better |
|---|---|---|---|
| `dso` * | `accounts_receivable / revenue * days` | days | lower |
| `dio` * | `inventory / cost_of_revenue * days` | days | lower |
| `dpo` | `accounts_payable / cost_of_revenue * days` | days | context |
| `cash_conversion_cycle` | `dso + dio - dpo` | days | lower |
| `asset_turnover` * | `revenue / total_assets` | x | higher |

### Profitability

| Key | Formula | Unit | Better |
|---|---|---|---|
| `gross_margin` * | `gross_profit / revenue` | % | higher |
| `operating_margin` * | `operating_income / revenue` | % | higher |
| `net_margin` * | `net_income / revenue` | % | higher |
| `ebitda_margin` | `EBITDA / revenue` | % | higher |
| `roa` * | `net_income / total_assets` | % | higher |
| `roe` * | `net_income / total_equity` | % | higher |

### Coverage

| Key | Formula | Unit | Better |
|---|---|---|---|
| `interest_coverage` * | `operating_income / interest_expense` | x | higher |
| `ebitda_interest_coverage` | `EBITDA / interest_expense` | x | higher |
| `cfo_to_debt` | `cash_from_operations / total_debt` | % | higher |
| `capex_coverage` | `cash_from_operations / capital_expenditures` | x | higher |

### DuPont

Not a 26th library entry. A decomposition card that reuses `net_margin`,
`asset_turnover` and `equity_multiplier`, shows the three side by side, and asserts their
product reconciles to `roe` within the shared tolerance. A mismatch is an inline warning
naming which component is missing, not a silent blank.

## 4. Computation semantics

These rules are the whole correctness surface of M2 and each one gets a test.

**4.1 Averaging.** A balance-sheet identifier is read as `(opening + closing) / 2` when,
and only when, all three hold: the workspace averaging mode is `average`, the expression
also references an income-statement or cash-flow identifier (a flow over a stock), and the
immediately prior period is present in the workspace. Otherwise the ending balance is
used. Pure stock-over-stock ratios such as `current_ratio` and `debt_to_equity` never
average, in either mode, because both sides are measured at the same instant.

When averaging is requested but the prior period is absent, the ratio still computes on
the ending balance and the card carries an inline note saying so. Falling back silently
would make the earliest period quietly non-comparable with the rest.

The rule is uniform: it applies to custom ratios exactly as it does to built-ins.

**4.2 Day counts.** `days` is 365 for an `FY` period and 91.25 for a `Q` period. The
alternative, annualising quarterly flows by four, is arithmetically the same thing; this
form keeps the multiplier visible in the component breakdown. Days ratios computed on
quarterly periods carry a note that they annualise a single quarter.

**4.3 Sign normalisation.** Source statements present some figures as negatives and some as
magnitudes, and M1 preserves whichever the document used. For ratio purposes the following
keys are read as magnitudes: `interest_expense`, `capital_expenditures`, `income_tax_expense`,
`cost_of_revenue`, `operating_expenses`, `dividends_paid`. The list is explicit and
exported, never a heuristic on the value's sign, so a genuinely negative interest expense
(interest income net) does not get silently flipped. The component breakdown shows both the
stored value and the magnitude used.

**4.4 Missing and degenerate inputs.** A ratio evaluates to one of three states:

- `ok` with a number
- `unavailable` because a referenced cell has no value, naming the missing keys
- `undefined_denominator` because the denominator is zero or, for ratios where a negative
  denominator makes the result meaningless (`interest_coverage`, `net_debt_to_ebitda`,
  `debt_to_equity`, `roe`), because it is negative

Never `NaN`, never `Infinity`, never a number the user cannot interpret. A negative
denominator is a real financial condition, so the card says which one it is: negative
equity, negative EBITDA, net interest income. Suppressing the number and explaining why
beats printing `-4.1x` and letting the user misread it as leverage.

**4.5 Confidence and provenance propagation.** A ratio's confidence is the minimum
confidence across its component cells. If any component is an override, the card is marked
as containing user edits. If any component carries a low-confidence warning, the card
inherits it. Clicking a component in the breakdown opens the existing M1 provenance panel
for that cell, so the trail from a ratio back to a printed page is unbroken.

**4.6 Period ordering.** Ratios are computed for every period in the workspace and
displayed most recent first, reusing `sortPeriodsMostRecentFirst`. Mixing `FY` and `Q`
periods in one workspace produces a warning on days-based and turnover ratios, since the
trend line then compares annual and quarterly flows.

## 5. Custom ratios

**Grammar.**

```
expr    := term (('+' | '-') term)*
term    := factor (('*' | '/') factor)*
factor  := '-'? primary
primary := NUMBER | IDENT | '(' expr ')'
IDENT   := a canonical line-item key, or the key of another saved ratio in this workspace
```

Hand-written recursive descent over a hand-written tokeniser. No `eval`, no `Function`, no
third-party parser. Unknown identifiers, unbalanced parentheses, empty expressions, and
division by a literal zero are rejected at save time with the offending character offset.

**References between ratios.** A custom ratio may reference another saved ratio's key,
which is what makes `cash_conversion_cycle` expressible by a user rather than special. The
reference graph is topologically sorted with cycle detection before evaluation; a cycle is
rejected at save time and names the loop.

**Building.** Drag line-item chips into the expression track, or use the "Add" button on
each chip, which appends the same token. The raw expression is always visible and directly
editable, because the text field is the real interface and the drag surface is a
convenience over it. A live preview computes the ratio for every period before saving, so
an expression that produces `unavailable` everywhere is visible before it is stored.

**Interpretation.** Custom ratios have no authored definitional text. They get the
situational half plus the user's own note field, exactly as the parent spec requires.

## 6. Interpretation

**Definitional half.** Authored in `src/model/ratios/library.ts` next to each definition:
what it measures, how it is computed, which direction is generally favourable, and the
standard caveat. Rendered instantly, no API call, identical every time.

**Situational half.** A button per card. The request carries only: ratio key and label, the
definitional text, the unit and direction, the ordered period labels, the computed value per
period, the numerator and denominator per period, and the averaging mode. It never carries
document text, raw labels, or anything the extractor saw.

The prompt instructs: describe the movement and its arithmetic drivers, name which
component moved more, decline where fewer than two periods have values, make no forward
statement, cite no fact not present in the payload, and stay under roughly 80 words.
Structured output through `client.messages.parse()` with `zodOutputFormat`, per the M1
global constraints, returning `{ text, declined, reason }` so a refusal is a value rather
than prose that has to be pattern-matched.

**Caching.** Keyed on a SHA-256 of the model id, prompt version, ratio key, averaging mode,
and the ordered value tuples. Editing a cell changes the hash, so the read regenerates.
Reopening a workspace does not. The cache row records tokens in and out, so cost is
visible rather than assumed.

**Failure modes.** Missing API key, API error, and a declined generation are three separate
states with three separate messages. None of them blocks the numbers: the definitional
half and the computed values are always present.

## 7. Data model additions

```
custom_ratios     id, workspaceId, key, label, expression, note, createdAt
                  unique (workspaceId, key)
interpretations   id, workspaceId, ratioKey, inputHash, text, declined, reason,
                  modelId, promptVersion, tokensIn, tokensOut, createdAt
                  unique (workspaceId, ratioKey, inputHash)
workspaces        + averagingMode text not null default 'average'   -- 'average' | 'ending'
```

Built-in ratios live in code, not in the database. They are versioned with the app, are the
same for every workspace, and their definitional text needs review in a diff rather than a
row.

Deleting a custom ratio deletes its cached interpretations. Deleting a line item, or an
extraction run, leaves custom ratios intact; they simply evaluate to `unavailable` and say
which key went missing.

## 8. UI

A `Ratios` view alongside the existing statements view on the workspace screen.

- **Header controls:** focus toggle (`Core 12` / `All 25`), averaging toggle
  (`Average balances` / `Ending balances`), and `New ratio`.
- **Family sections:** the five families in the order given in §3, each collapsible.
- **Ratio card:** label with the definitional tooltip, the most recent period's value large,
  a compact per-period row, an inline SVG sparkline of the trend, direction indicator,
  inherited warnings, `Show inputs`, and `Explain the trend`.
- **Show inputs:** numerator and denominator per period, the canonical keys behind each,
  the day multiplier where one applies, whether averaging was used, and any sign
  normalisation. Each component links to the M1 provenance panel.
- **Ratio builder drawer:** chip palette grouped by statement, expression track, live
  preview table, note field, save and cancel.

The sparkline is inline SVG written for this purpose. Recharts arrives in M3 where real
charting starts; pulling it in for a 60-pixel trend line would be a dependency paying for
nothing.

Follows the house `anti-vibecode` standards, as all UI work in this project does.

**Error tiers**, consistent with parent spec §8:

- Blocking banner: none new. A ratio that cannot compute is a card-level state, not a page
  state, because the other 24 are still valid.
- Inline warnings: missing inputs, degenerate denominator, averaging fallback, mixed period
  types, low confidence inherited from a component, override present in a component.
- Toasts: ratio saved, ratio deleted with undo, interpretation failed.

**Tooltips:** `ratio.<key>` for all 25, plus control keys for the focus toggle, averaging
toggle, sparkline, explain button, inputs expander, and builder targets. The existing
completeness test is extended so a ratio without a tooltip fails the suite.

## 9. Testing

- **Library and engine:** a fixture three-statement model with three periods and hand-computed
  expected values for all 25 ratios in both averaging modes. Table-driven.
- **Semantics:** one test per rule in §4, including the averaging fallback, the quarterly day
  count, each sign-normalised key, and each degenerate-denominator case.
- **Parser:** valid expressions round-trip; malformed input reports the right offset; unknown
  identifiers, cycles, and literal division by zero are rejected.
- **Interpretation:** the client seam is stubbed. Cache hit, cache miss, hash invalidation on
  edit, missing key, API error, and declined generation.
- **Purity:** the existing `src/model` purity guard covers the new ratio modules.
- **UI:** card states (ok, unavailable, degenerate, warning-laden), focus and averaging
  toggles, builder drag and its keyboard equivalent, and one Playwright pass from an
  extracted workspace to a saved custom ratio.

## 10. Out of scope for M2

- Per-share and valuation multiples. They need share count and a market price, which means
  extending the taxonomy and the extractor, and that belongs with a milestone that owns
  extraction.
- Peer or industry benchmarks, per the parent spec.
- Forecast periods and scenario-scoped ratios. Ratios are expressions over the same graph,
  so M3 gets them by extending the period and scenario axes, not by rewriting this layer.
- Ratio blocks in the report. M4.

## 11. Assumption flagged for review

Days-based ratios on quarterly periods annualise a single quarter (§4.2) rather than
computing a trailing-twelve-month figure. TTM needs four consecutive quarters, which most
single-document workspaces will not have, and a TTM figure that silently falls back to one
quarter is worse than one that never claimed to be TTM. If you want TTM, it belongs in M3
where multi-document workspaces make four quarters realistic.
