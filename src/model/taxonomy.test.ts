import { describe, it, expect } from "vitest";
import { TAXONOMY, lineItem, itemsFor } from "./taxonomy";
import { buildUserPrompt } from "@/extract/prompt";

describe("taxonomy", () => {
  it("has unique keys", () => {
    const keys = TAXONOMY.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every item a non-empty definition for tooltips", () => {
    for (const item of TAXONOMY) {
      expect(item.definition.length, `${item.key} has no definition`).toBeGreaterThan(0);
    }
  });

  it("resolves a known key", () => {
    expect(lineItem("revenue")?.statement).toBe("income");
  });

  it("returns undefined for an unknown key", () => {
    expect(lineItem("not_a_real_line_item")).toBeUndefined();
  });

  it("returns items for a statement sorted by order", () => {
    const items = itemsFor("balance");
    expect(items.length).toBeGreaterThan(5);
    const orders = items.map((i) => i.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("points every parentKey at a real subtotal", () => {
    for (const item of TAXONOMY) {
      if (item.parentKey === null) continue;
      const parent = lineItem(item.parentKey);
      expect(parent, `${item.key} has dangling parent ${item.parentKey}`).toBeDefined();
      expect(parent!.isSubtotal).toBe(true);
    }
  });

  it("has a revolver line item that sits between short_term_debt and other_current_liabilities", () => {
    const revolver = lineItem("revolver");
    expect(revolver).toBeDefined();
    expect(revolver!.statement).toBe("balance");
    expect(revolver!.parentKey).toBe("total_current_liabilities");
    expect(revolver!.isSubtotal).toBe(false);
    const shortTermDebt = lineItem("short_term_debt")!;
    const otherCurrentLiabilities = lineItem("other_current_liabilities")!;
    expect(revolver!.order).toBeGreaterThan(shortTermDebt.order);
    expect(revolver!.order).toBeLessThan(otherCurrentLiabilities.order);
  });

  it("marks absentMeansZero on revolver only", () => {
    // The escape hatch from the ratio engine's "missing input makes the ratio
    // unavailable" rule stays a single, deliberate opt-in, not a list that quietly
    // grows.
    const flagged = TAXONOMY.filter((i) => i.absentMeansZero === true).map((i) => i.key);
    expect(flagged).toEqual(["revolver"]);
  });

  it("never offers an absentMeansZero key to the extraction model", () => {
    // The real guard: an absentMeansZero key names a forecast construct the extractor
    // must never be told is a legitimate mapping target, or a real "revolving credit
    // facility" line could map onto `revolver` and the taxonomy's own documented
    // invariant ("always absent in extracted historicals") would become false in the
    // one place that matters. This is checked against the actual built prompt, not a
    // list that could drift from what the model is really shown.
    const prompt = buildUserPrompt({ label: "test", text: "irrelevant" });
    const flagged = TAXONOMY.filter((i) => i.absentMeansZero === true);
    expect(flagged.length).toBeGreaterThan(0);
    for (const item of flagged) {
      expect(new RegExp(`\\b${item.key}\\b`).test(prompt), item.key).toBe(false);
    }
    // A real debt facility must still land somewhere: the exclusion must not have
    // taken its closest fits with it.
    expect(prompt).toContain("short_term_debt");
    expect(prompt).toContain("long_term_debt");
  });
});
