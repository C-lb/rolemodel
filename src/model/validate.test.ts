import { describe, it, expect } from "vitest";
import { validate, FINDING_CODES, type ValidateInput } from "./validate";
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

  it("does not compare cash against a prior period it cannot order", () => {
    // Both keys are unrankable, so the sort collapses to insertion order and the two
    // entries may be unrelated periods. Comparing them would invent a discrepancy.
    const data = {
      "FY24": balanced.FY2024,
      "2023": balanced.FY2023,
    };
    const findings = validate({ periods: ["FY24", "2023"], valueAt: lookupFrom(data) });
    expect(findings.some((f) => f.code === "cashflow_tie_out" && f.keys.includes("cash_and_equivalents")))
      .toBe(false);
  });

  it("does not compare cash across a gap in the period sequence", () => {
    // FY2022 is not FY2024's prior period, so a movement between them says nothing
    // about FY2024's net change in cash.
    const data = { FY2024: balanced.FY2024, FY2022: balanced.FY2023 };
    const findings = validate({ periods: ["FY2024", "FY2022"], valueAt: lookupFrom(data) });
    expect(findings.some((f) => f.code === "cashflow_tie_out" && f.keys.includes("cash_and_equivalents")))
      .toBe(false);
  });

  it("still compares cash between genuinely adjacent periods", () => {
    const broken = {
      ...balanced,
      FY2024: { ...balanced.FY2024, cash_from_operations: 110, net_change_in_cash: 50 },
    };
    const findings = validate(input({ valueAt: lookupFrom(broken) }));
    expect(findings.some((f) => f.code === "cashflow_tie_out" && f.keys.includes("cash_and_equivalents")))
      .toBe(true);
  });

  it("blocks on a period label it cannot order", () => {
    const findings = validate({ periods: ["FY2024", "Q2 2025"], valueAt: lookupFrom(balanced) });
    const finding = findings.find((f) => f.code === "missing_periods");
    expect(finding?.severity).toBe("blocking");
    expect(finding?.keys).toEqual(["Q2 2025"]);
    expect(finding?.message).toContain("Q2 2025");
  });

  it("warns about a gap in an otherwise regular annual sequence", () => {
    const data = { FY2024: balanced.FY2024, FY2022: balanced.FY2023 };
    const findings = validate({ periods: ["FY2024", "FY2022"], valueAt: lookupFrom(data) });
    const finding = findings.find((f) => f.code === "missing_periods");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("FY2023");
  });

  it("reports no period finding for a complete, orderable sequence", () => {
    expect(validate(input()).some((f) => f.code === "missing_periods")).toBe(false);
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

  it("does not flag total_current_liabilities when revolver is absent, as it always is historically", () => {
    // A historical document never produces a `revolver` fact. The subtotal check sums
    // whatever components it can see, so an absent revolver must stay harmless.
    const data = {
      FY2024: {
        ...balanced.FY2024,
        total_current_liabilities: 300,
        accounts_payable: 100,
        short_term_debt: 200,
      },
    };
    const findings = validate({ periods: ["FY2024"], valueAt: lookupFrom(data) });
    expect(findings.some((f) => f.code === "subtotal_mismatch" && f.keys.includes("total_current_liabilities")))
      .toBe(false);
  });

  it("carries the six forecast finding codes alongside M1's own", () => {
    for (const code of [
      "forecast_not_annual",
      "forecast_missing_base",
      "forecast_articulation_broken",
      "forecast_revolver_drawn",
      "forecast_equity_negative",
      "forecast_driver_default",
    ]) {
      expect(FINDING_CODES).toContain(code);
    }
  });
});
