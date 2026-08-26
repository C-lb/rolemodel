import { test, expect } from "@playwright/test";
import { WORKSPACE_ID } from "./seed";

test.beforeEach(async ({ page }) => {
  await page.goto(`/w/${WORKSPACE_ID}`);
  await page.getByRole("tab", { name: "Ratios" }).click();
});

test("shows the library and narrows to the core twelve", async ({ page }) => {
  await expect(page.getByRole("article")).toHaveCount(25);

  await page.getByRole("button", { name: "Core 12" }).click();
  await expect(page.getByRole("article")).toHaveCount(12);

  await page.getByRole("button", { name: "All 25" }).click();
  await expect(page.getByRole("article")).toHaveCount(25);
});

test("switching to average balances changes the numbers", async ({ page }) => {
  const card = page.getByRole("article").filter({ hasText: "Return on assets" });
  await expect(card.getByText("15.0%").first()).toBeVisible();

  await page.getByRole("button", { name: "Average balances" }).click();

  // 2,100 over the average of 12,000 and 14,000 rather than over 14,000.
  await expect(card.getByText("16.2%").first()).toBeVisible();
});

test("a component links back to where the figure came from", async ({ page }) => {
  const card = page.getByRole("article").filter({ hasText: "Net margin" }).first();
  await card.getByRole("button", { name: "Show inputs" }).click();
  await card.getByRole("button", { name: "Revenue, FY2024" }).first().click();

  await expect(page.getByRole("dialog")).toContainText("Where this figure came from");
  await expect(page.getByRole("dialog")).toContainText("Fixture line");
});

test("builds a custom ratio without dragging anything", async ({ page }) => {
  await page.getByRole("button", { name: "New ratio" }).click();

  await page.getByLabel("Name", { exact: true }).fill("Overhead intensity");
  await page.getByRole("button", { name: "Add Total operating expenses to the expression" }).click();
  // Exact: "Add Dividends paid to the expression" contains the word too.
  await page.getByRole("button", { name: "divide", exact: true }).click();
  await page.getByRole("button", { name: "Add Revenue to the expression" }).click();

  await expect(page.getByLabel("Expression", { exact: true })).toHaveValue("operating_expenses / revenue");
  await expect(page.getByText("0.20x").first()).toBeVisible();

  await page.getByRole("button", { name: "Save ratio" }).click();

  const card = page.getByRole("article").filter({ hasText: "Overhead intensity" });
  await expect(card).toBeVisible();
  await expect(card.getByText("0.20x").first()).toBeVisible();
});
