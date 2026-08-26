import { describe, it, expect } from "vitest";
import {
  runForecast, articulates, HELD_AT_ZERO_KEYS, SIGN_OBSERVED_KEYS,
  TOTAL_ASSETS_PARTS, TOTAL_LIABILITIES_PARTS, type ForecastInput,
} from "./engine";
import { TAXONOMY, lineItem, type StatementKind } from "../taxonomy";
import { DRIVER_KEYS } from "./drivers";
import {
  EXPECTED_FORECAST,
  EXPECTED_PLUGS,
  EXPECTED_PLUG_CASH,
  FY2024,
  PLUG_PERIODS,
  SIGN_FLIPPED_KEYS,
  POSITIVE_HISTORY_ONLY_KEYS,
  fixtureForecastInput,
  plugForecastInput,
  positiveCostForecastInput,
  positiveCostRows,
  historicalRows,
  withOverrides,
  type Row,
} from "./fixtures";

const FORECAST_PERIODS = ["FY2025", "FY2026"];

/**
 * The engine's own articulation tolerance, not `closeEnough`. The expectations below are
 * hand-computed to full precision, so the only thing they need to forgive is
 * floating-point noise. Comparing them at `closeEnough`'s 0.5 per cent would let a
 * 3.6-unit error in FY2026 cash pass every literal assertion in this file.
 */
function expectMoney(actual: number | undefined, expected: number, what: string): void {
  expect(actual, `${what} was missing`).toBeTypeOf("number");
  const got = actual as number;
  expect(Number.isFinite(got), `${what} is ${got}, which is not a finite number`).toBe(true);
  expect(articulates(got, expected), `${what}: expected ${expected}, got ${got}`).toBe(true);
}

function run(input: ForecastInput = fixtureForecastInput()) {
  return runForecast(input);
}

function keysOf(row: Row, statement: StatementKind): string[] {
  return Object.keys(row).filter((k) => lineItem(k)?.statement === statement);
}

describe("runForecast: the hand-worked fixture", () => {
  it("matches every income-statement literal in both periods", () => {
    const result = run();
    expect(result.ok).toBe(true);
    for (const period of FORECAST_PERIODS) {
      const expected = EXPECTED_FORECAST[period];
      const keys = keysOf(expected, "income");
      expect(keys.length).toBeGreaterThan(10);
      for (const key of keys) {
        expectMoney(result.valueAt(key, period), expected[key], `${key} in ${period}`);
      }
    }
  });

  it("matches every cash-flow literal in both periods", () => {
    const result = run();
    for (const period of FORECAST_PERIODS) {
      const expected = EXPECTED_FORECAST[period];
      const keys = keysOf(expected, "cashflow");
      expect(keys.length).toBeGreaterThan(10);
      for (const key of keys) {
        expectMoney(result.valueAt(key, period), expected[key], `${key} in ${period}`);
      }
    }
  });

  it("matches every balance-sheet literal in both periods", () => {
    const result = run();
    for (const period of FORECAST_PERIODS) {
      const expected = EXPECTED_FORECAST[period];
      const keys = keysOf(expected, "balance");
      expect(keys.length).toBeGreaterThan(20);
      for (const key of keys) {
        expectMoney(result.valueAt(key, period), expected[key], `${key} in ${period}`);
      }
    }
  });

  it("covers every taxonomy key, so no literal above is missing by omission", () => {
    // The three tests above iterate the expectation rows. This one iterates the
    // taxonomy, so a key left out of the expectations cannot go unnoticed.
    const expectedKeys = new Set(Object.keys(EXPECTED_FORECAST.FY2025));
    for (const item of TAXONOMY) {
      expect(expectedKeys.has(item.key), `${item.key} has no hand-worked expectation`).toBe(true);
    }
  });

  it("gives a value and a formula to every taxonomy key in every forecast period", () => {
    const result = run();
    for (const period of FORECAST_PERIODS) {
      for (const item of TAXONOMY) {
        const cell = result.cells.find((c) => c.canonicalKey === item.key && c.periodKey === period);
        expect(cell, `no cell for ${item.key} in ${period}`).toBeDefined();
        expect(cell?.formula.length ?? 0, `${item.key} has no formula`).toBeGreaterThan(0);
        expect(Number.isFinite(cell?.value ?? NaN)).toBe(true);
      }
    }
  });
});

describe("runForecast: sign convention", () => {
  it("agrees with the engine on which keys carry an observed sign", () => {
    expect([...SIGN_OBSERVED_KEYS].sort()).toEqual([...SIGN_FLIPPED_KEYS].sort());
  });

  it("keeps the negative sign a costs-negative history printed", () => {
    const result = run();
    for (const key of SIGN_FLIPPED_KEYS) {
      const historical = FY2024[key];
      expect(historical, `fixture has no historical ${key}`).toBeTypeOf("number");
      for (const period of FORECAST_PERIODS) {
        const forecast = result.valueAt(key, period) as number;
        expect(
          Math.sign(forecast),
          `${key} is ${forecast} in ${period} but ${historical} in FY2024`,
        ).toBe(Math.sign(historical));
      }
    }
  });

  it("keeps the positive sign a costs-positive history printed", () => {
    // The fixture that would have caught the hardcoded convention: the same company
    // filing the other way round. Without the observed sign this run produces a forecast
    // whose cost of revenue is negative against a history that prints it positive.
    const rows = positiveCostRows();
    const result = runForecast(positiveCostForecastInput());
    expect(result.ok).toBe(true);
    for (const key of SIGN_FLIPPED_KEYS) {
      expect(Math.sign(rows.FY2024[key]), `${key} should be positive in this fixture`).toBe(1);
      for (const period of FORECAST_PERIODS) {
        const forecast = result.valueAt(key, period) as number;
        expect(Math.sign(forecast), `${key} in ${period}`).toBe(1);
      }
    }
  });

  it("keeps cash-flow outflows negative even when the filing printed them positive", () => {
    // The cash-flow statement adds signed cash effects. A positive capital expenditure
    // makes the displayed sections disagree with the displayed bottom line, whatever
    // the filing's presentation, so these two lines are not sign-observed.
    const rows = positiveCostRows();
    const result = runForecast(positiveCostForecastInput());
    for (const key of POSITIVE_HISTORY_ONLY_KEYS) {
      expect(Math.sign(rows.FY2024[key]), `${key} is positive in this history`).toBe(1);
      for (const period of FORECAST_PERIODS) {
        expect(Math.sign(result.valueAt(key, period) as number), `${key} in ${period}`).toBe(-1);
      }
    }
    expect(SIGN_OBSERVED_KEYS.has("capital_expenditures")).toBe(false);
    expect(SIGN_OBSERVED_KEYS.has("dividends_paid")).toBe(false);
  });

  it("changes only the presentation, never the balance sheet", () => {
    const negative = run();
    const positive = runForecast(positiveCostForecastInput());
    for (const period of FORECAST_PERIODS) {
      for (const key of ["total_assets", "total_equity", "cash_and_equivalents", "net_income", "retained_earnings"]) {
        expectMoney(positive.valueAt(key, period), negative.valueAt(key, period) as number, `${key} in ${period}`);
      }
    }
  });

  it("takes the most recent non-zero period, not an average across history", () => {
    // FY2024 prints cost of revenue positive; the two earlier years print it negative.
    // The reader last saw positive, so the forecast prints positive.
    const rows = historicalRows();
    rows.FY2024 = { ...rows.FY2024, cost_of_revenue: 660 };
    const result = runForecast(fixtureForecastInput({ rows }));
    expect(Math.sign(result.valueAt("cost_of_revenue", "FY2025") as number)).toBe(1);
  });

  it("skips a zero and reads the period before it", () => {
    const rows = historicalRows();
    rows.FY2024 = { ...rows.FY2024, income_tax_expense: 0 };
    rows.FY2023 = { ...rows.FY2023, income_tax_expense: 54 };
    const result = runForecast(fixtureForecastInput({ rows }));
    expect(Math.sign(result.valueAt("income_tax_expense", "FY2025") as number)).toBe(1);
  });

  it("keeps spec 5.1's convention when history says nothing", () => {
    // The plug fixture reports none of the signed keys at all.
    const result = runForecast(plugForecastInput({ drivers: { capex_pct_revenue: 0.1, gross_margin: 0.4, rd_pct_revenue: 0.05 } }));
    expect(Math.sign(result.valueAt("cost_of_revenue", "FY2025") as number)).toBe(-1);
    expect(Math.sign(result.valueAt("research_development", "FY2025") as number)).toBe(-1);
  });
});

describe("runForecast: subtotals and held items", () => {
  const SUBTOTALS_WITH_COMPONENTS = TAXONOMY
    .filter((i) => i.isSubtotal && TAXONOMY.some((c) => c.parentKey === i.key))
    .map((i) => i.key);

  it("sums every subtotal from its taxonomy components rather than carrying it forward", () => {
    // No exceptions. `cash_from_financing` used to be one, because the revolver movement
    // had nowhere to sit; `revolver_movement` is now a line item and the property is
    // universal again.
    for (const input of [fixtureForecastInput(), positiveCostForecastInput()]) {
      const result = runForecast(input);
      for (const period of FORECAST_PERIODS) {
        for (const key of SUBTOTALS_WITH_COMPONENTS) {
          const parts = TAXONOMY.filter((i) => i.parentKey === key);
          const sum = parts.reduce((s, p) => s + (result.valueAt(p.key, period) as number), 0);
          expectMoney(result.valueAt(key, period), sum, `${key} in ${period}`);
        }
      }
    }
  });

  it("builds total_assets and total_liabilities from the taxonomy, not a hardcoded list", () => {
    // These two subtotals have no `parentKey` children, so the check above skips them
    // and a balance-sheet line added later could drop out of the total unnoticed.
    expect(TOTAL_ASSETS_PARTS).toEqual([
      "total_current_assets", "property_plant_equipment", "goodwill",
      "intangible_assets", "other_noncurrent_assets",
    ]);
    expect(TOTAL_LIABILITIES_PARTS).toEqual([
      "total_current_liabilities", "long_term_debt", "other_noncurrent_liabilities",
    ]);
    // And the derivation covers every top-level balance-sheet line exactly once.
    const topLevel = TAXONOMY
      .filter((i) => i.statement === "balance" && i.parentKey === null)
      .map((i) => i.key);
    const covered = [...TOTAL_ASSETS_PARTS, ...TOTAL_LIABILITIES_PARTS, "total_assets", "total_liabilities", "total_equity"];
    expect([...covered].sort()).toEqual([...topLevel].sort());

    const result = run();
    for (const period of FORECAST_PERIODS) {
      const assets = TOTAL_ASSETS_PARTS.reduce((s, k) => s + (result.valueAt(k, period) as number), 0);
      expectMoney(result.valueAt("total_assets", period), assets, `total_assets in ${period}`);
      const liabilities = TOTAL_LIABILITIES_PARTS.reduce((s, k) => s + (result.valueAt(k, period) as number), 0);
      expectMoney(result.valueAt("total_liabilities", period), liabilities, `total_liabilities in ${period}`);
    }
  });

  it("foots every subtotal the taxonomy gives no children, over both conventions", () => {
    // The gap the sign bug shipped through. The component check above only reaches
    // subtotals that have `parentKey` children; `net_change_in_cash` has none, because
    // the four cash-flow sections are all top-level, so nothing asserted that the
    // displayed bottom line equalled the displayed sections. It did not: flipping
    // capital expenditure and dividends put the cash-flow statement out by 295.2.
    //
    // Every parentless subtotal now has a footing, and the completeness assertion below
    // means a new one cannot be added without one.
    // NO `Math.abs` ANYWHERE HERE. Wrapping each cost child in a magnitude made these
    // footings blind to the one thing they most need to catch: a sign error on
    // cost_of_revenue, operating_expenses, interest_expense or income_tax_expense
    // foots identically either way once the magnitude is taken. Instead, each cost line
    // is read back into spec 5.1's own convention using the sign THIS fixture's history
    // printed, which is the same rule the engine emits by. A cost line that comes out
    // the wrong way round now fails the footing rather than passing it.
    type Lookup = (key: string) => number;
    /** The value as spec 5.1 computes it: costs negative, whichever way they print. */
    type Cost = (key: string) => number;
    const footings: Record<string, (v: Lookup, cost: Cost) => number> = {
      gross_profit: (v, cost) => v("revenue") + cost("cost_of_revenue"),
      // operating_expenses is a subtotal with no history of its own, so it is footed
      // from the two children whose printed sign the fixture does define.
      operating_income: (v, cost) =>
        v("gross_profit") + cost("research_development") + cost("selling_general_admin"),
      pretax_income: (v, cost) => v("operating_income") + cost("interest_expense") + v("other_income_expense"),
      net_income: (v, cost) => v("pretax_income") + cost("income_tax_expense"),
      total_assets: (v) => TOTAL_ASSETS_PARTS.reduce((s, k) => s + v(k), 0),
      total_liabilities: (v) => TOTAL_LIABILITIES_PARTS.reduce((s, k) => s + v(k), 0),
      // The cash-flow statement ADDS signed cash effects, in every convention. This is
      // the assertion that was missing.
      net_change_in_cash: (v) =>
        v("cash_from_operations") + v("cash_from_investing") + v("cash_from_financing") + v("fx_effect_on_cash"),
    };

    const parentless = TAXONOMY
      .filter((i) => i.isSubtotal && !TAXONOMY.some((c) => c.parentKey === i.key))
      .map((i) => i.key);
    expect([...parentless].sort(), "a parentless subtotal has no footing").toEqual(Object.keys(footings).sort());

    const fixtures: { name: string; input: ForecastInput; history: Row }[] = [
      { name: "costs negative", input: fixtureForecastInput(), history: historicalRows().FY2024 },
      { name: "costs positive", input: positiveCostForecastInput(), history: positiveCostRows().FY2024 },
    ];
    for (const { name, input, history } of fixtures) {
      const result = runForecast(input);
      expect(result.ok).toBe(true);
      for (const period of FORECAST_PERIODS) {
        const v: Lookup = (key) => result.valueAt(key, period) as number;
        // Read back into the negative convention using the sign the fixture's own
        // history printed. If the forecast emitted the opposite sign, this returns the
        // wrong-signed number rather than absorbing the error, and the footing fails.
        const cost: Cost = (key) => {
          const printedNegative = history[key] < 0;
          expect(history[key], `${key} has no sign in the ${name} fixture`).not.toBe(0);
          return printedNegative ? v(key) : -v(key);
        };
        for (const [key, foot] of Object.entries(footings)) {
          expectMoney(v(key), foot(v, cost), `${key} in ${period} (${name})`);
        }
      }
    }
  });

  it("holds the held-flat balances at their opening value", () => {
    const result = run();
    const flat = ["short_term_investments", "other_current_assets", "goodwill", "intangible_assets",
      "other_noncurrent_assets", "accrued_liabilities", "deferred_revenue_current",
      "other_current_liabilities", "short_term_debt", "other_noncurrent_liabilities",
      "treasury_stock", "accumulated_oci"];
    for (const key of flat) {
      const opening = FY2024[key];
      for (const period of FORECAST_PERIODS) {
        expectMoney(result.valueAt(key, period), opening, `${key} in ${period}`);
      }
    }
  });

  it("holds every key in HELD_AT_ZERO_KEYS at zero", () => {
    const result = run();
    expect(HELD_AT_ZERO_KEYS.length).toBe(4);
    for (const key of HELD_AT_ZERO_KEYS) {
      for (const period of FORECAST_PERIODS) {
        expect(result.valueAt(key, period), `${key} in ${period}`).toBe(0);
      }
    }
  });
});

describe("runForecast: roll-forwards", () => {
  it("moves retained earnings by exactly net income plus dividends", () => {
    const result = run();
    let opening = FY2024.retained_earnings;
    for (const period of FORECAST_PERIODS) {
      const netIncome = result.valueAt("net_income", period) as number;
      const dividends = result.valueAt("dividends_paid", period) as number;
      expectMoney(result.valueAt("retained_earnings", period), opening + netIncome + dividends, `retained_earnings in ${period}`);
      opening = result.valueAt("retained_earnings", period) as number;
    }
  });

  it("moves PP&E by exactly capex less depreciation", () => {
    const result = run();
    let opening = FY2024.property_plant_equipment;
    for (const period of FORECAST_PERIODS) {
      const capex = result.valueAt("capital_expenditures", period) as number;
      const depreciation = result.valueAt("depreciation_amortisation", period) as number;
      expectMoney(result.valueAt("property_plant_equipment", period), opening + Math.abs(capex) - depreciation, `property_plant_equipment in ${period}`);
      opening = result.valueAt("property_plant_equipment", period) as number;
    }
  });

  // This is the guard the articulation invariant cannot be: depreciating the closing
  // balance instead of the opening one adds the same amount to cash (through the
  // operating addback) as it removes from PP&E, so total assets do not move and the
  // balance sheet still closes. Mutation-tested: swapping in the closing balance leaves
  // the articulation test green and turns this one red.
  it("depreciates the OPENING PP&E, not the closing balance", () => {
    const result = run();
    const rate = 0.1;
    const openings = [FY2024.property_plant_equipment, result.valueAt("property_plant_equipment", "FY2025") as number];
    FORECAST_PERIODS.forEach((period, i) => {
      const closing = result.valueAt("property_plant_equipment", period) as number;
      const charge = result.valueAt("depreciation_amortisation", period) as number;
      expectMoney(charge, openings[i] * rate, `depreciation in ${period} on opening PP&E`);
      expect(
        articulates(charge, closing * rate),
        `depreciation in ${period} is ${charge}, which is the CLOSING PP&E ${closing} times ${rate}`,
      ).toBe(false);
    });
  });

  it("charges interest on OPENING debt including the opening revolver", () => {
    // FY2025 draws 150 on the revolver. FY2026 must be charged on that 150 even though
    // it repays part of it during the period.
    const result = runForecast(plugForecastInput({ drivers: { interest_rate_debt: 0.1 } }));
    expect(result.ok).toBe(true);
    // FY2025 opens with no debt at all, so no interest, and the draw is unaffected.
    expectMoney(result.valueAt("interest_expense", "FY2025"), 0, "interest in FY2025");
    expectMoney(result.valueAt("revolver", "FY2025"), 150, "revolver in FY2025");
    // FY2026 opens on that revolver: -(0 + 0 + 150) * 0.10.
    expectMoney(result.valueAt("interest_expense", "FY2026"), -15, "interest in FY2026");
    const closingRevolver = result.valueAt("revolver", "FY2026") as number;
    expect(
      articulates(result.valueAt("interest_expense", "FY2026") as number, -(closingRevolver * 0.1)),
      `FY2026 interest was charged on the CLOSING revolver ${closingRevolver}`,
    ).toBe(false);
  });

  it("adds interest income on OPENING cash to other income", () => {
    const result = run();
    expectMoney(result.valueAt("other_income_expense", "FY2025"), 15 + FY2024.cash_and_equivalents * 0.05, "other income FY2025");
    const openingCash2 = result.valueAt("cash_and_equivalents", "FY2025") as number;
    expectMoney(result.valueAt("other_income_expense", "FY2026"), 15 + openingCash2 * 0.05, "other income FY2026");
  });

  it("pays no tax in a loss period rather than booking a credit", () => {
    const result = runForecast(fixtureForecastInput({ drivers: { gross_margin: -0.5 } }));
    expect(result.ok).toBe(true);
    const pretax = result.valueAt("pretax_income", "FY2025") as number;
    expect(pretax).toBeLessThan(0);
    expectMoney(result.valueAt("income_tax_expense", "FY2025"), 0, "tax on a loss");
    expectMoney(result.valueAt("net_income", "FY2025"), pretax, "net income on a loss");
    expectMoney(result.valueAt("dividends_paid", "FY2025"), 0, "dividends on a loss");
  });
});

describe("runForecast: the plug", () => {
  const result = runForecast(plugForecastInput());

  it("reports the four plug cases from spec 11", () => {
    expect(result.ok).toBe(true);
    expect(result.plugs.map((p) => p.periodKey)).toEqual(PLUG_PERIODS);
    EXPECTED_PLUGS.forEach((expected) => {
      const actual = result.plugs.find((p) => p.periodKey === expected.periodKey);
      expect(actual, `no plug for ${expected.periodKey}`).toBeDefined();
      expectMoney(actual?.cashBeforePlug, expected.cashBeforePlug, `cashBeforePlug ${expected.periodKey}`);
      expectMoney(actual?.drawn, expected.drawn, `drawn ${expected.periodKey}`);
      expectMoney(actual?.repaid, expected.repaid, `repaid ${expected.periodKey}`);
      expectMoney(actual?.revolverBalance, expected.revolverBalance, `revolver ${expected.periodKey}`);
    });
  });

  it("puts the revolver balance on the balance sheet and its movement on its own cash-flow line", () => {
    for (const period of PLUG_PERIODS) {
      const expected = EXPECTED_PLUG_CASH[period];
      const plug = EXPECTED_PLUGS.find((p) => p.periodKey === period);
      expectMoney(result.valueAt("revolver", period), plug?.revolverBalance ?? 0, `revolver balance ${period}`);
      expectMoney(result.valueAt("revolver_movement", period), expected.revolverMovement, `revolver_movement ${period}`);
      expectMoney(result.valueAt("cash_and_equivalents", period), expected.cash, `cash ${period}`);
      expectMoney(result.valueAt("cash_from_financing", period), expected.cashFromFinancing, `cash_from_financing ${period}`);
      expectMoney(result.valueAt("net_change_in_cash", period), expected.netChangeInCash, `net_change_in_cash ${period}`);
    }
  });

  it("keeps cash_from_financing the sum of its components while the revolver moves", () => {
    for (const period of PLUG_PERIODS) {
      const parts = TAXONOMY.filter((i) => i.parentKey === "cash_from_financing");
      const sum = parts.reduce((s, p) => s + (result.valueAt(p.key, period) as number), 0);
      expectMoney(result.valueAt("cash_from_financing", period), sum, `cash_from_financing in ${period}`);
    }
  });

  it("holds cash on the floor while the revolver is only partly repaid", () => {
    expectMoney(result.valueAt("cash_and_equivalents", "FY2026"), 1000, "cash held on the floor");
    expectMoney(result.plugs[1]?.repaid, 50, "partial repayment");
    expectMoney(result.plugs[1]?.revolverBalance, 100, "revolver still outstanding");
  });
});

describe("runForecast: the articulation invariant", () => {
  const cases: { name: string; input: ForecastInput; periods: string[]; openingCash: number }[] = [
    { name: "the hand-worked fixture", input: fixtureForecastInput(), periods: FORECAST_PERIODS, openingCash: FY2024.cash_and_equivalents },
    { name: "the positive-cost fixture", input: positiveCostForecastInput(), periods: FORECAST_PERIODS, openingCash: FY2024.cash_and_equivalents },
    { name: "the plug fixture", input: plugForecastInput(), periods: PLUG_PERIODS, openingCash: 1000 },
    { name: "a loss fixture", input: fixtureForecastInput({ drivers: { gross_margin: -0.5 } }), periods: FORECAST_PERIODS, openingCash: FY2024.cash_and_equivalents },
  ];

  for (const testCase of cases) {
    it(`closes the balance sheet in every period of ${testCase.name}`, () => {
      const result = runForecast(testCase.input);
      expect(result.ok, result.findings.map((f) => f.message).join("; ")).toBe(true);
      let openingCash = testCase.openingCash;
      for (const period of testCase.periods) {
        const assets = result.valueAt("total_assets", period) as number;
        const liabilities = result.valueAt("total_liabilities", period) as number;
        const equity = result.valueAt("total_equity", period) as number;
        expect(
          articulates(assets, liabilities + equity),
          `${period}: assets ${assets} against liabilities plus equity ${liabilities + equity}`,
        ).toBe(true);

        const cash = result.valueAt("cash_and_equivalents", period) as number;
        const netChange = result.valueAt("net_change_in_cash", period) as number;
        expect(
          articulates(openingCash + netChange, cash),
          `${period}: opening cash ${openingCash} plus net change ${netChange} against closing cash ${cash}`,
        ).toBe(true);
        openingCash = cash;
      }
    });
  }

  it("is tight enough that the fixture's size cannot arm it", () => {
    // `closeEnough` would allow max(1, 0.005 * 1443) = 7.2 on this balance sheet, which
    // is larger than the working-capital movement the guard is supposed to catch.
    expect(articulates(1443.3, 1443.3 + 7)).toBe(false);
    expect(articulates(1443.3, 1443.3 + 0.01)).toBe(false);
    // Floating-point noise still passes.
    expect(articulates(1443.3, 1443.3 + 1e-10)).toBe(true);
  });
});

describe("runForecast: findings", () => {
  function codes(findings: { code: string }[]): string[] {
    return findings.map((f) => f.code);
  }

  it("refuses a base period that is not a full year, with no cells at all", () => {
    const rows = historicalRows();
    const result = runForecast({
      historicalPeriods: ["Q4-2024"],
      forecastPeriods: FORECAST_PERIODS,
      valueAt: (key, period) => (period === "Q4-2024" ? rows.FY2024[key] : undefined),
      driverAt: () => 0.1,
    });
    expect(result.ok).toBe(false);
    expect(codes(result.findings)).toContain("forecast_not_annual");
    expect(result.cells).toEqual([]);
    expect(result.plugs).toEqual([]);
    expect(result.valueAt("revenue", "FY2025")).toBeUndefined();
  });

  it("names the opening balance it is missing, and returns no cells", () => {
    const input = fixtureForecastInput(
      withOverrides([{ period: "FY2024", key: "retained_earnings", value: undefined }]),
    );
    const result = runForecast(input);
    expect(result.ok).toBe(false);
    const finding = result.findings.find((f) => f.code === "forecast_missing_base");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocking");
    expect(finding?.keys).toContain("retained_earnings");
    expect(finding?.periodKey).toBe("FY2024");
    expect(result.cells).toEqual([]);
  });

  it("does not treat an absent revolver as a missing base", () => {
    // `revolver` is `absentMeansZero` in the taxonomy and no filing ever reports one.
    expect(FY2024.revolver).toBeUndefined();
    const result = run();
    expect(codes(result.findings)).not.toContain("forecast_missing_base");
    expectMoney(result.valueAt("revolver", "FY2025"), 0, "revolver with no opening balance");
  });

  it("warns without blocking when the revolver is drawn", () => {
    const result = runForecast(plugForecastInput());
    const finding = result.findings.find((f) => f.code === "forecast_revolver_drawn");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("FY2025");
    expect(result.ok).toBe(true);
    expect(result.cells.length).toBeGreaterThan(0);
  });

  it("does not warn about the revolver when it is never drawn", () => {
    expect(codes(run().findings)).not.toContain("forecast_revolver_drawn");
  });

  it("warns when total equity falls below zero", () => {
    // A loss large enough to wipe out the opening equity in one year. Overriding the
    // opening retained earnings instead would unbalance the opening balance sheet, and
    // the engine rightly refuses that as broken articulation rather than warning about it.
    const result = runForecast(fixtureForecastInput({ drivers: { gross_margin: -0.5 } }));
    const finding = result.findings.find((f) => f.code === "forecast_equity_negative");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(result.ok).toBe(true);
    expect(result.valueAt("total_equity", "FY2025")).toBeLessThan(0);
  });

  it("does not warn about equity when it stays positive", () => {
    expect(codes(run().findings)).not.toContain("forecast_equity_negative");
  });

  it("reports at info when a driver is a fallback constant", () => {
    const result = runForecast(fixtureForecastInput({ defaultedDrivers: ["interest_rate_cash", "debt_repayment"] }));
    const finding = result.findings.find((f) => f.code === "forecast_driver_default");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("info");
    expect(finding?.keys).toEqual(["interest_rate_cash", "debt_repayment"]);
    expect(result.ok).toBe(true);
  });

  it("stays silent when every driver is derived", () => {
    expect(codes(run().findings)).not.toContain("forecast_driver_default");
  });

  it("refuses a forecast period the scenario has no drivers for, and names the period", () => {
    // The engine's half of the stale-scenario defect: a period with no driver rows used
    // to fall through to DRIVER_DEFAULTS silently, so a forecast nobody's assumptions
    // produced came back ok.
    const base = fixtureForecastInput();
    const result = runForecast({
      ...base,
      forecastPeriods: ["FY2025", "FY2026", "FY2027"],
      driverAt: (key, period) => (period === "FY2027" ? undefined : base.driverAt(key, period)),
    });

    expect(result.ok).toBe(false);
    expect(result.cells).toEqual([]);
    const finding = result.findings.find((f) => f.code === "forecast_drivers_missing");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocking");
    expect(finding?.periodKey).toBe("FY2027");
    expect(finding?.keys).toEqual([...DRIVER_KEYS]);
  });

  it("blames the assumptions, not the engine, for a driver no forecast can be computed over", () => {
    // Both values are typeable in the driver grid. Both used to come back as
    // forecast_articulation_broken, whose remediation tells the user to report an engine
    // bug. It was the assumptions.
    const cases: Record<string, number>[] = [{ revenue_growth: -1e6 }, { tax_rate: 1e300 }];
    for (const drivers of cases) {
      const result = runForecast(fixtureForecastInput({ drivers }));
      expect(result.ok).toBe(false);
      expect(result.cells).toEqual([]);
      const finding = result.findings.find((f) => f.code === "forecast_driver_implausible");
      expect(finding, JSON.stringify(drivers)).toBeDefined();
      expect(finding?.severity).toBe("blocking");
      expect(finding?.keys).toEqual(Object.keys(drivers));
      expect(finding?.remediation).not.toMatch(/defect in the forecast engine/);
      // And the engine-bug finding is not raised alongside it.
      expect(codes(result.findings)).not.toContain("forecast_articulation_broken");
    }
  });

  it("leaves a large but usable driver alone", () => {
    // The bound has to sit far outside anything a real model uses, or it becomes a
    // modelling opinion. 900 per cent growth is absurd and still computed.
    const result = runForecast(fixtureForecastInput({ drivers: { revenue_growth: 9 } }));
    expect(codes(result.findings)).not.toContain("forecast_driver_implausible");
    expect(result.ok).toBe(true);
  });

  it("stays silent when no driver basis is supplied at all", () => {
    const result = runForecast(fixtureForecastInput({ omitDriverBasis: true }));
    expect(codes(result.findings)).not.toContain("forecast_driver_default");
    expect(result.ok).toBe(true);
  });
});

describe("runForecast: hostile input", () => {
  // The "a forecast cell is never NaN or Infinity" rule, driven at rather than assumed.
  // Every case must either come back blocked or come back entirely finite; a rendered
  // grid with a NaN in it is the outcome none of them may produce.
  const hostile: { name: string; input: ForecastInput }[] = [
    {
      name: "a growth rate that overflows a double",
      input: fixtureForecastInput({ drivers: { revenue_growth: 1e308 } }),
    },
    {
      name: "a growth rate of negative one million",
      input: fixtureForecastInput({ drivers: { revenue_growth: -1e6 } }),
    },
    {
      name: "zero revenue in every historical period",
      input: fixtureForecastInput(withOverrides([
        { period: "FY2024", key: "revenue", value: 0 },
        { period: "FY2023", key: "revenue", value: 0 },
        { period: "FY2022", key: "revenue", value: 0 },
      ])),
    },
    {
      name: "a zero denominator everywhere a ratio could divide",
      input: fixtureForecastInput({
        drivers: { gross_margin: 1, dso: 0, dio: 0, dpo: 0, depreciation_pct_ppe: 0, capex_pct_revenue: 0 },
      }),
    },
    {
      name: "negative days and a negative minimum cash",
      input: fixtureForecastInput({ drivers: { dso: -365, dio: -365, dpo: -365, min_cash: -1e9 } }),
    },
    {
      name: "a tax rate of 1e300",
      input: fixtureForecastInput({ drivers: { tax_rate: 1e300 } }),
    },
    {
      name: "every driver reporting NaN",
      input: { ...fixtureForecastInput(), driverAt: () => NaN },
    },
    {
      name: "every driver reporting Infinity",
      input: { ...fixtureForecastInput(), driverAt: () => Infinity },
    },
    {
      name: "every driver missing",
      input: { ...fixtureForecastInput(), driverAt: () => undefined },
    },
    {
      name: "a history with no opening balances at all",
      input: { ...fixtureForecastInput(), valueAt: () => undefined },
    },
    {
      name: "a history reporting NaN for an opening balance",
      input: fixtureForecastInput(withOverrides([{ period: "FY2024", key: "property_plant_equipment", value: NaN }])),
    },
    {
      name: "a hundred forecast periods of compounding",
      input: fixtureForecastInput({
        forecastPeriods: Array.from({ length: 100 }, (_, i) => `FY${2025 + i}`),
        drivers: { revenue_growth: 9 },
      }),
    },
  ];

  for (const testCase of hostile) {
    it(`never returns a non-finite cell for ${testCase.name}`, () => {
      const result = runForecast(testCase.input);
      if (!result.ok) {
        // A refused forecast returns nothing to render, and says why.
        expect(result.cells).toEqual([]);
        expect(result.findings.some((f) => f.severity === "blocking")).toBe(true);
        return;
      }
      const bad = result.cells.filter((c) => !Number.isFinite(c.value));
      expect(
        bad.map((c) => `${c.canonicalKey}@${c.periodKey}=${c.value}`),
        "a rendered forecast cell is not a finite number",
      ).toEqual([]);
    });
  }

  it("refuses, rather than renders, when the arithmetic overflows", () => {
    // The case that proves the NaN sweep fires rather than being unreachable. The
    // overflow comes from the HISTORY, not from a driver: a driver big enough to
    // overflow is now refused by name as an implausible assumption before the
    // arithmetic runs, so an out-of-range driver can no longer reach this guard and
    // would leave it untested if it were still the input used here.
    const result = runForecast(fixtureForecastInput({
      ...withOverrides([{ period: "FY2024", key: "revenue", value: 1e308 }]),
      drivers: { revenue_growth: 9 },
    }));
    expect(result.ok).toBe(false);
    expect(result.cells).toEqual([]);
    const broken = result.findings.filter((f) => f.code === "forecast_articulation_broken");
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((f) => f.severity === "blocking")).toBe(true);
    expect(broken.some((f) => f.message.includes("finite")), broken.map((f) => f.message).join("; ")).toBe(true);
  });
});

describe("runForecast: provenance", () => {
  it("records the operands it actually used, not a re-derived label", () => {
    const result = run();
    const interest = result.cells.find((c) => c.canonicalKey === "interest_expense" && c.periodKey === "FY2026");
    expect(interest?.formula).toContain("FY2025");
    // 50 short-term, 130 long-term, 0 revolver, at 10 per cent.
    expect(interest?.inputs.map((i) => i.value)).toEqual([50, 130, 0, 0.1]);

    const retained = result.cells.find((c) => c.canonicalKey === "retained_earnings" && c.periodKey === "FY2025");
    const values = retained?.inputs.map((i) => i.value) ?? [];
    expect(values).toHaveLength(3);
    expectMoney(values[0], 376, "opening retained earnings");
    expectMoney(values[1], 254, "net income");
    expectMoney(values[2], -50.8, "dividends");
    expectMoney(values.reduce((a, b) => a + b, 0), retained?.value ?? NaN, "the operands add to the cell");
  });
});
