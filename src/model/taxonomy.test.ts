import { describe, it, expect } from "vitest";
import { TAXONOMY, lineItem, itemsFor } from "./taxonomy";

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
});
