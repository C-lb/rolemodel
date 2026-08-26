import { describe, it, expect } from "vitest";
import { runForecast, HELD_AT_ZERO_KEYS, type ForecastInput } from "./engine";
import { TAXONOMY, lineItem, type StatementKind } from "../taxonomy";
import { closeEnough } from "../tolerance";
import {
  EXPECTED_FORECAST,
  EXPECTED_PLUGS,
  EXPECTED_PLUG_CASH,
  FY2024,
  PLUG_PERIODS,
  fixtureForecastInput,
  plugForecastInput,
  historicalRows,
  withOverrides,
  type Row,
} from "./fixtures";

const FORECAST_PERIODS = ["FY2025", "FY2026"];

/** Money never compares with ===. */
function expectMoney(actual: number | undefined, expected: number, what: string): void {
  expect(actual, `${what} was missing`).toBeTypeOf("number");
  const got = actual as number;
  expect(Number.isFinite(got), `${what} is ${got}, which is not a finite number`).toBe(true);
  expect(
    closeEnough(got, expected),
    `${what}: expected ${expected}, got ${got}`,
  ).toBe(true);
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
  // Costs and outflows keep the sign the filing printed. The forecast must not invent a
  // second convention; this is the test that catches a stray negation.
  const SIGNED_KEYS = [
    "cost_of_revenue", "interest_expense", "income_tax_expense",
    "capital_expenditures", "dividends_paid",
  ];

  it("keeps the sign the last historical period used", () => {
    const result = run();
    for (const key of SIGNED_KEYS) {
      const historical = FY2024[key];
      expect(historical, `fixture has no historical ${key}`).toBeTypeOf("number");
      expect(Math.sign(historical), `${key} should be negative in the fixture`).toBe(-1);
      for (const period of FORECAST_PERIODS) {
        const forecast = result.valueAt(key, period) as number;
        expect(
          Math.sign(forecast),
          `${key} is ${forecast} in ${period} but ${historical} in FY2024`,
        ).toBe(Math.sign(historical));
      }
    }
  });
});

describe("runForecast: subtotals and held items", () => {
  const SUBTOTALS_WITH_COMPONENTS = TAXONOMY
    .filter((i) => i.isSubtotal && TAXONOMY.some((c) => c.parentKey === i.key))
    .map((i) => i.key);

  it("sums each subtotal from its taxonomy components rather than carrying it forward", () => {
    const result = run();
    for (const period of FORECAST_PERIODS) {
      for (const key of SUBTOTALS_WITH_COMPONENTS) {
        const parts = TAXONOMY.filter((i) => i.parentKey === key);
        const sum = parts.reduce((s, p) => s + (result.valueAt(p.key, period) as number), 0);
        if (key === "cash_from_financing") {
          // The taxonomy has no cash-flow line for the revolver, so the financing
          // subtotal carries the movement on top of its components (spec 5.3). Here it
          // is zero; the plug tests below are where the movement is non-zero.
          const plug = result.plugs.find((p) => p.periodKey === period);
          expectMoney(result.valueAt(key, period), sum + (plug?.drawn ?? 0) - (plug?.repaid ?? 0), `${key} in ${period}`);
          continue;
        }
        expectMoney(result.valueAt(key, period), sum, `${key} in ${period}`);
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

  it("holds the zeroed cash-flow lines at zero", () => {
    const result = run();
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
    // FY2025 opens on the FY2024 balance; FY2026 opens on the FY2025 balance, which is
    // the case that a closing-balance bug would still get right if only one period ran.
    const openings = [FY2024.property_plant_equipment, result.valueAt("property_plant_equipment", "FY2025") as number];
    FORECAST_PERIODS.forEach((period, i) => {
      const closing = result.valueAt("property_plant_equipment", period) as number;
      const charge = result.valueAt("depreciation_amortisation", period) as number;
      expectMoney(charge, openings[i] * rate, `depreciation in ${period} on opening PP&E`);
      expect(
        closeEnough(charge, closing * rate),
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
      closeEnough(result.valueAt("interest_expense", "FY2026") as number, -(closingRevolver * 0.1)),
      `FY2026 interest was charged on the CLOSING revolver ${closingRevolver}`,
    ).toBe(false);
  });

  it("adds interest income on OPENING cash to other income", () => {
    const result = run();
    // 15 + 400 * 0.05 in FY2025, then 15 + 559.5 * 0.05 on the FY2025 closing cash.
    expectMoney(result.valueAt("other_income_expense", "FY2025"), 15 + FY2024.cash_and_equivalents * 0.05, "other income FY2025");
    const openingCash2 = result.valueAt("cash_and_equivalents", "FY2025") as number;
    expectMoney(result.valueAt("other_income_expense", "FY2026"), 15 + openingCash2 * 0.05, "other income FY2026");
  });

  it("pays no tax in a loss period rather than booking a credit", () => {
    // A negative gross margin puts pre-tax income well below zero.
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

  it("puts the revolver balance on the balance sheet and its movement in financing", () => {
    for (const period of PLUG_PERIODS) {
      const expected = EXPECTED_PLUG_CASH[period];
      const plug = EXPECTED_PLUGS.find((p) => p.periodKey === period);
      expectMoney(result.valueAt("revolver", period), plug?.revolverBalance ?? 0, `revolver balance ${period}`);
      expectMoney(result.valueAt("cash_and_equivalents", period), expected.cash, `cash ${period}`);
      expectMoney(result.valueAt("cash_from_financing", period), expected.cashFromFinancing, `cash_from_financing ${period}`);
      expectMoney(result.valueAt("net_change_in_cash", period), expected.netChangeInCash, `net_change_in_cash ${period}`);
    }
  });

  it("holds cash on the floor while the revolver is only partly repaid", () => {
    // FY2026's surplus of 50 is smaller than the 150 outstanding, so all of it goes to
    // the revolver and cash stays exactly on the 1000 floor.
    expectMoney(result.valueAt("cash_and_equivalents", "FY2026"), 1000, "cash held on the floor");
    expectMoney(result.plugs[1]?.repaid, 50, "partial repayment");
    expectMoney(result.plugs[1]?.revolverBalance, 100, "revolver still outstanding");
  });
});

describe("runForecast: the articulation invariant", () => {
  const cases: { name: string; input: ForecastInput; periods: string[]; openingCash: number }[] = [
    { name: "the hand-worked fixture", input: fixtureForecastInput(), periods: FORECAST_PERIODS, openingCash: FY2024.cash_and_equivalents },
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
          closeEnough(assets, liabilities + equity),
          `${period}: assets ${assets} against liabilities plus equity ${liabilities + equity}`,
        ).toBe(true);

        const cash = result.valueAt("cash_and_equivalents", period) as number;
        const netChange = result.valueAt("net_change_in_cash", period) as number;
        expect(
          closeEnough(openingCash + netChange, cash),
          `${period}: opening cash ${openingCash} plus net change ${netChange} against closing cash ${cash}`,
        ).toBe(true);
        openingCash = cash;
      }
    });
  }
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

  it("stays silent when no driver basis is supplied at all", () => {
    const result = runForecast(fixtureForecastInput({ omitDriverBasis: true }));
    expect(codes(result.findings)).not.toContain("forecast_driver_default");
    expect(result.ok).toBe(true);
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
    expectMoney(values[1], 298, "net income");
    expectMoney(values[2], -59.6, "dividends");
    expectMoney(values.reduce((a, b) => a + b, 0), retained?.value ?? NaN, "the operands add to the cell");
  });
});
