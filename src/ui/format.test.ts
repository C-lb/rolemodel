import { describe, it, expect } from "vitest";
import {
  formatMoney,
  parseMoney,
  formatRatio,
  formatDriverValue,
  parseDriverValue,
  driverEditValue,
} from "./format";
import type { DriverUnit } from "@/model/forecast/drivers";

describe("formatMoney", () => {
  it("groups thousands", () => expect(formatMoney(1234567)).toBe("1,234,567"));
  it("wraps negatives in parentheses", () => expect(formatMoney(-500)).toBe("(500)"));
  it("renders an absent value as an em dash", () => expect(formatMoney(undefined)).toBe("—"));
  it("renders zero as zero, not a dash", () => expect(formatMoney(0)).toBe("0"));
});

describe("parseMoney", () => {
  it("accepts grouped digits", () => expect(parseMoney("1,234")).toBe(1234));
  it("accepts parenthesised negatives", () => expect(parseMoney("(500)")).toBe(-500));
  it("accepts a leading minus", () => expect(parseMoney("-500")).toBe(-500));
  it("accepts decimals", () => expect(parseMoney("1.5")).toBe(1.5));
  it("accepts a currency symbol", () => expect(parseMoney("$1,000")).toBe(1000));
  it("rejects letters", () => expect(parseMoney("about 500")).toBeNull());
  it("rejects an empty string", () => expect(parseMoney("  ")).toBeNull());
  it("rejects two minus signs", () => expect(parseMoney("--5")).toBeNull());
});

describe("formatRatio", () => {
  it("renders a multiple with two decimals and an x", () => {
    expect(formatRatio(1.8432, "x")).toBe("1.84x");
    expect(formatRatio(-2, "x")).toBe("-2.00x");
  });

  it("renders a rate as a percentage with one decimal", () => {
    expect(formatRatio(0.3821, "percent")).toBe("38.2%");
    expect(formatRatio(-0.045, "percent")).toBe("-4.5%");
  });

  it("renders days as whole days", () => {
    expect(formatRatio(68.133, "days")).toBe("68 days");
    expect(formatRatio(1, "days")).toBe("1 day");
  });

  it("renders a currency figure the way money is rendered everywhere else", () => {
    expect(formatRatio(4200, "currency")).toBe(formatMoney(4200));
    expect(formatRatio(-4200, "currency")).toBe(formatMoney(-4200));
  });

  it("never renders a non-number as one", () => {
    for (const unit of ["x", "percent", "days", "currency"] as const) {
      expect(formatRatio(Number.NaN, unit)).not.toMatch(/NaN/);
      expect(formatRatio(Number.POSITIVE_INFINITY, unit)).not.toMatch(/Infinity/);
    }
  });
});

describe("formatDriverValue", () => {
  it("renders a percent driver as a percentage, stored value stays a decimal", () => {
    expect(formatDriverValue(0.0345, "percent")).toBe("3.45%");
    expect(formatDriverValue(-0.02, "percent")).toBe("-2.00%");
  });

  it("renders a days driver as a whole day count with no unit suffix baked into the stored value", () => {
    expect(formatDriverValue(45, "days")).toBe("45");
    expect(formatDriverValue(45.6, "days")).toBe("46");
  });

  it("renders a currency driver exactly as formatMoney does", () => {
    expect(formatDriverValue(125000, "currency")).toBe(formatMoney(125000));
    expect(formatDriverValue(-500, "currency")).toBe(formatMoney(-500));
  });

  it("renders an absent driver value as an em dash for every unit", () => {
    for (const unit of ["percent", "days", "currency"] as const) {
      expect(formatDriverValue(undefined, unit)).toBe("—");
    }
  });
});

describe("driverEditValue: the raw string a click-to-edit field seeds its draft with", () => {
  it("shows a percent driver's decimal as plain percentage points, no % sign", () => {
    expect(driverEditValue(0.0345, "percent")).toBe("3.45");
  });

  it("clears binary floating-point noise from the scaled percentage, exact string", () => {
    // 0.035 * 100 is 3.5000000000000004 in raw JS arithmetic, 0.07 * 100 is
    // 7.000000000000001, and 0.29 * 100 is 28.999999999999996. A user who opens the
    // editor on a driver seeded at 3.5% must see "3.5", never that noise.
    expect(driverEditValue(0.035, "percent")).toBe("3.5");
    expect(driverEditValue(0.07, "percent")).toBe("7");
    expect(driverEditValue(0.29, "percent")).toBe("29");
  });

  it("shows a days driver as a plain day count", () => {
    expect(driverEditValue(45, "days")).toBe("45");
  });

  it("shows a currency driver as the raw figure, matching parseMoney's own money convention", () => {
    expect(driverEditValue(-2500, "currency")).toBe("-2500");
  });
});

describe("parseDriverValue", () => {
  it("parses a typed percentage, with or without the % sign, back to a decimal", () => {
    expect(parseDriverValue("3.45%", "percent")).toBeCloseTo(0.0345, 10);
    expect(parseDriverValue("3.45", "percent")).toBeCloseTo(0.0345, 10);
    expect(parseDriverValue("-2", "percent")).toBeCloseTo(-0.02, 10);
  });

  it("parses a typed day count as a plain number", () => {
    expect(parseDriverValue("45", "days")).toBe(45);
  });

  it("parses currency the same way parseMoney does", () => {
    expect(parseDriverValue("(2,500)", "currency")).toBe(-2500);
  });

  it("rejects unparseable input for every unit", () => {
    for (const unit of ["percent", "days", "currency"] as const) {
      expect(parseDriverValue("nonsense", unit)).toBeNull();
      expect(parseDriverValue("", unit)).toBeNull();
    }
  });

  it("round-trips every unit through the editor's display value without drift", () => {
    // 0.035, 0.07 and 0.29 are exactly the values that expose the drift: each is
    // "dirty" under a plain `value * 100` in IEEE 754 (3.5000000000000004,
    // 7.000000000000001, 28.999999999999996). An exact `toBe`, not `toBeCloseTo`, is
    // the point: a numeric tolerance would pass even if `driverEditValue` still
    // returned the noisy string, since parsing it back divides the noise away again.
    const cases: { value: number; unit: DriverUnit }[] = [
      { value: 0.0345, unit: "percent" },
      { value: 0.3, unit: "percent" },
      { value: -0.02, unit: "percent" },
      { value: 0.035, unit: "percent" },
      { value: 0.07, unit: "percent" },
      { value: 0.29, unit: "percent" },
      { value: 45, unit: "days" },
      { value: 0, unit: "days" },
      { value: 125000, unit: "currency" },
      { value: -500, unit: "currency" },
    ];
    for (const { value, unit } of cases) {
      const edited = driverEditValue(value, unit);
      expect(edited).not.toMatch(/0000000|9999999/);
      const parsed = parseDriverValue(edited, unit);
      expect(parsed).toBe(value);
    }
  });

  it("round-trips the full formatted display value too, % sign and all", () => {
    const formatted = formatDriverValue(0.0345, "percent");
    expect(parseDriverValue(formatted, "percent")).toBeCloseTo(0.0345, 10);
  });
});
