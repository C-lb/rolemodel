import { describe, it, expect } from "vitest";
import { TOOLTIPS, CONTROL_KEYS, tooltip } from "./tooltips";
import { TAXONOMY } from "@/model/taxonomy";
import { FINDING_CODES } from "@/model/validate";

describe("tooltip registry", () => {
  it("has an entry for every canonical line item", () => {
    const missing = TAXONOMY.filter((i) => !TOOLTIPS[`item.${i.key}`]).map((i) => i.key);
    expect(missing).toEqual([]);
  });

  it("has an entry for every finding code", () => {
    const missing = FINDING_CODES.filter((c) => !TOOLTIPS[`finding.${c}`]);
    expect(missing).toEqual([]);
  });

  it("has an entry for every control", () => {
    const missing = CONTROL_KEYS.filter((c) => !TOOLTIPS[c]);
    expect(missing).toEqual([]);
  });

  it("has no empty entries", () => {
    const empty = Object.entries(TOOLTIPS).filter(([, v]) => v.trim().length === 0).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it("throws on an unknown key so gaps surface in development", () => {
    expect(() => tooltip("item.does_not_exist")).toThrow(/does_not_exist/);
  });
});
