import { describe, it, expect } from "vitest";
import { formatMoney, parseMoney } from "./format";

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
