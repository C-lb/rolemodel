import { describe, it, expect } from "vitest";
import { formatMoney, parseMoney, formatRatio } from "./format";

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
