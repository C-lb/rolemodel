import { describe, it, expect } from "vitest";
import { validate, type ValidateInput } from "./validate";
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
});
