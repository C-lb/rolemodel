import { describe, it, expect } from "vitest";
import { TAXONOMY } from "@/model/taxonomy";
import {
  RATIOS,
  CORE_KEYS,
  MAGNITUDE_KEYS,
  RATIO_FAMILIES,
  ratio,
  ratiosFor,
} from "./library";

const taxonomyKeys = new Set(TAXONOMY.map((i) => i.key));
const ratioKeys = new Set(RATIOS.map((r) => r.key));

/** Every bare word in an expression, which is either a line item or another ratio. */
function identifiersIn(expression: string): string[] {
  return expression.match(/[a-z][a-z0-9_]*/g) ?? [];
}

describe("ratio library", () => {
  it("ships twenty-five ratios", () => {
    expect(RATIOS).toHaveLength(25);
  });

  it("has unique keys", () => {
    expect(ratioKeys.size).toBe(RATIOS.length);
  });

  it("marks exactly twelve as core", () => {
    const core = RATIOS.filter((r) => r.isCore).map((r) => r.key);
    expect(core).toHaveLength(12);
    expect([...CORE_KEYS].sort()).toEqual(core.sort());
  });

  it("covers all five families", () => {
    for (const family of RATIO_FAMILIES) {
      expect(ratiosFor(family).length, family).toBeGreaterThan(0);
    }
    const families = new Set(RATIOS.map((r) => r.family));
    expect(families.size).toBe(RATIO_FAMILIES.length);
  });

  it("references only real line items and real ratios", () => {
    for (const r of RATIOS) {
      for (const name of identifiersIn(r.expression)) {
        expect(
          taxonomyKeys.has(name) || ratioKeys.has(name),
          `${r.key} references unknown identifier "${name}"`,
        ).toBe(true);
      }
    }
  });

  it("never references itself", () => {
    for (const r of RATIOS) {
      expect(identifiersIn(r.expression), r.key).not.toContain(r.key);
    }
  });

  it("gives every ratio a definition and a caveat", () => {
    for (const r of RATIOS) {
      expect(r.definition.length, `${r.key} definition`).toBeGreaterThan(40);
      expect(r.caveat.length, `${r.key} caveat`).toBeGreaterThan(20);
      expect(r.label.length, `${r.key} label`).toBeGreaterThan(2);
    }
  });

  it("normalises presentation signs only for real line items", () => {
    for (const key of MAGNITUDE_KEYS) {
      expect(taxonomyKeys.has(key), key).toBe(true);
    }
    expect(MAGNITUDE_KEYS).toContain("interest_expense");
    expect(MAGNITUDE_KEYS).toContain("capital_expenditures");
  });

  it("suppresses the ratios a negative denominator would make meaningless", () => {
    const suppressed = RATIOS.filter((r) => r.denominatorMustBePositive).map((r) => r.key).sort();
    expect(suppressed).toEqual(
      ["debt_to_equity", "interest_coverage", "net_debt_to_ebitda", "roe"].sort(),
    );
  });

  it("looks a ratio up by key", () => {
    expect(ratio("current_ratio")?.family).toBe("liquidity");
    expect(ratio("not_a_ratio")).toBeUndefined();
  });
});

describe("day scaling", () => {
  it("scales only the three raw days ratios", () => {
    const scaled = RATIOS.filter((r) => r.dayScaled).map((r) => r.key).sort();
    expect(scaled).toEqual(["dio", "dpo", "dso"]);
  });

  it("never scales a ratio built from ratios already in days", () => {
    expect(ratio("cash_conversion_cycle")?.unit).toBe("days");
    expect(ratio("cash_conversion_cycle")?.dayScaled).toBe(false);
  });
});
