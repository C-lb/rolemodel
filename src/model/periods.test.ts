import { describe, it, expect } from "vitest";
import {
  PERIOD_KEY_PATTERN,
  UNRANKED,
  isRankablePeriodKey,
  isImmediatePredecessor,
  missingPeriodsInSequence,
  periodRank,
  sortPeriodsMostRecentFirst,
} from "./periods";

describe("period keys", () => {
  it("accepts the two documented shapes", () => {
    expect(isRankablePeriodKey("FY2024")).toBe(true);
    expect(isRankablePeriodKey("Q2-2025")).toBe(true);
  });

  it("rejects plausible near-misses a filing header might produce", () => {
    for (const key of ["FY24", "2024", "Q2 2025", "Q5-2025", "fy2024", "FY2024 ", "Q2-25"]) {
      expect(isRankablePeriodKey(key), key).toBe(false);
      expect(periodRank(key), key).toBe(UNRANKED);
    }
  });

  it("exposes a pattern the extraction schema can reuse", () => {
    expect(PERIOD_KEY_PATTERN.test("FY2024")).toBe(true);
    expect(PERIOD_KEY_PATTERN.test("FY24")).toBe(false);
  });

  it("ranks a later year above an earlier one, and a later quarter above an earlier one", () => {
    expect(periodRank("FY2024")).toBeGreaterThan(periodRank("FY2023"));
    expect(periodRank("Q2-2025")).toBeGreaterThan(periodRank("Q1-2025"));
    expect(periodRank("Q1-2025")).toBeGreaterThan(periodRank("FY2024"));
  });

  it("sorts most recent first and puts unrankable keys last", () => {
    expect(sortPeriodsMostRecentFirst(["FY2023", "FY2024", "Q1-2025"]))
      .toEqual(["Q1-2025", "FY2024", "FY2023"]);
    expect(sortPeriodsMostRecentFirst(["FY24", "FY2024"])).toEqual(["FY2024", "FY24"]);
  });
});

describe("isImmediatePredecessor", () => {
  it("is true for consecutive years and consecutive quarters", () => {
    expect(isImmediatePredecessor("FY2024", "FY2023")).toBe(true);
    expect(isImmediatePredecessor("Q1-2025", "Q4-2024")).toBe(true);
  });

  it("is false across a gap, across families, and for unrankable keys", () => {
    expect(isImmediatePredecessor("FY2024", "FY2022")).toBe(false);
    expect(isImmediatePredecessor("Q1-2025", "FY2024")).toBe(false);
    expect(isImmediatePredecessor("FY2024", "FY24")).toBe(false);
    expect(isImmediatePredecessor("2024", "2023")).toBe(false);
  });
});

describe("missingPeriodsInSequence", () => {
  it("finds nothing in a complete annual run", () => {
    expect(missingPeriodsInSequence(["FY2024", "FY2023", "FY2022"])).toEqual([]);
  });

  it("finds the gap in an otherwise regular annual run", () => {
    expect(missingPeriodsInSequence(["FY2024", "FY2022"])).toEqual(["FY2023"]);
  });

  it("finds the gap in a quarterly run that crosses a year boundary", () => {
    expect(missingPeriodsInSequence(["Q2-2025", "Q3-2024"])).toEqual(["Q1-2025", "Q4-2024"]);
  });

  it("treats annual and quarterly runs independently", () => {
    expect(missingPeriodsInSequence(["FY2024", "FY2023", "Q1-2025"])).toEqual([]);
  });

  it("ignores unrankable keys rather than guessing at them", () => {
    expect(missingPeriodsInSequence(["FY2024", "2023", "FY2022"])).toEqual(["FY2023"]);
  });

  it("finds nothing when there is only one period in a family", () => {
    expect(missingPeriodsInSequence(["FY2024"])).toEqual([]);
  });
});
