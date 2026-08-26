import { test, expect, type Page } from "@playwright/test";
import { WORKSPACE_ID } from "./seed";

/**
 * The seeded workspace's three periods (FY2022-FY2024) are already annual, and its
 * facts now include the equity breakdown (`common_stock_apic`, `retained_earnings`)
 * the forecast engine's opening-balance gate requires (`REQUIRED_OPENING_KEYS` in
 * `model/forecast/engine.ts`) — see `seed.ts`'s `EQUITY_BREAKDOWN`. Without it this
 * workspace is annual but still refuses to forecast, which is not the path this file
 * is here to walk.
 *
 * Scenarios persist in the shared seeded database across every test in this file
 * (`workers: 1`, `fullyParallel: false`), so only the first test to reach the tab
 * presses "Set up scenarios" - every later test finds the trio already there.
 */
async function ensureScenarios(page: Page): Promise<void> {
  const setup = page.getByRole("button", { name: "Set up scenarios" });
  if (await setup.isVisible().catch(() => false)) {
    await setup.click();
  }
  await expect(page.getByRole("button", { name: "Base, base scenario" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto(`/w/${WORKSPACE_ID}`);
  await page.getByRole("tab", { name: "Forecast" }).click();
});

test("sets up scenarios and shows the forecast statement with no blocking finding", async ({ page }) => {
  await ensureScenarios(page);
  await expect(page.getByRole("button", { name: "Bull", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bear", exact: true })).toBeVisible();
  await expect(page.getByText(/cannot be forecast/)).toHaveCount(0);

  // Revenue growth derived from FY2023 to FY2024: (15,000 - 12,000) / 12,000 = 25%.
  await expect(page.getByRole("button", { name: "Revenue growth, FY2025: 25.00%" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Revenue, FY2025:.*Show the forecast formula/ }))
    .toContainText("18,750"); // 15,000 * 1.25
});

test("editing a driver moves a downstream forecast statement figure", async ({ page }) => {
  await ensureScenarios(page);

  const driverCell = page.getByRole("button", { name: "Revenue growth, FY2025: 25.00%" });
  const revenueCell = page.getByRole("button", { name: /Revenue, FY2025:.*Show the forecast formula/ });
  await expect(revenueCell).toContainText("18,750");

  await driverCell.dblclick();
  const input = page.getByRole("textbox");
  await input.fill("30");
  await input.press("Enter");

  await expect(page.getByRole("button", { name: "Revenue growth, FY2025: 30.00%" })).toBeVisible();
  await expect(revenueCell).toContainText("19,500"); // 15,000 * 1.30

  // Leave the driver as this test found it, so later tests see the seeded 25%.
  await page.getByRole("button", { name: "Revenue growth, FY2025: 30.00%" }).dblclick();
  await page.getByRole("textbox").fill("25");
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByRole("button", { name: "Revenue growth, FY2025: 25.00%" })).toBeVisible();
});

test("fills a driver right with the mouse", async ({ page }) => {
  await ensureScenarios(page);

  await page.getByRole("button", { name: "Revenue growth, FY2026: 25.00%" }).dblclick();
  await page.getByRole("textbox").fill("40");
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByRole("button", { name: "Revenue growth, FY2026: 40.00%" })).toBeVisible();

  await page.getByRole("button", { name: "Fill revenue growth right from FY2026" }).click();

  await expect(page.getByRole("button", { name: "Revenue growth, FY2027: 40.00%" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Revenue growth, FY2029: 40.00%" })).toBeVisible();
});

test("fills a driver right with the keyboard alone", async ({ page }) => {
  await ensureScenarios(page);

  const fillButton = page.getByRole("button", { name: "Fill revenue growth right from FY2025" });
  await fillButton.focus();
  await expect(fillButton).toBeFocused();
  await page.keyboard.press("Enter");

  // FY2025's own value (still 25%, the previous test only touched FY2026 onward)
  // now sits in FY2026 too.
  await expect(page.getByRole("button", { name: "Revenue growth, FY2026: 25.00%" })).toBeVisible();
});

test("switches scenarios with the mouse and with the keyboard", async ({ page }) => {
  await ensureScenarios(page);

  await page.getByRole("button", { name: "Bull", exact: true }).click();
  // Bull nudges revenue growth up 300bps from the derived 25%.
  await expect(page.getByRole("button", { name: "Revenue growth, FY2025: 28.00%" })).toBeVisible();

  const baseTab = page.getByRole("button", { name: "Base, base scenario" });
  await baseTab.focus();
  await expect(baseTab).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Revenue growth, FY2025: 25.00%" })).toBeVisible();
});

test("changes the forecast horizon", async ({ page }) => {
  await ensureScenarios(page);
  // Three forecast statements plus the driver grid all have an "FY2029" column
  // header, so this scopes to the driver grid's own table by its caption.
  const driverTable = page.getByRole("table", { name: "Forecast drivers" });
  await expect(driverTable.getByRole("columnheader", { name: "FY2029" })).toBeVisible();

  const horizon = page.getByLabel("Forecast horizon, one to five periods");
  await horizon.fill("2");
  await horizon.press("Tab");

  await expect(driverTable.getByRole("columnheader", { name: "FY2027" })).toHaveCount(0);
  await expect(driverTable.getByRole("columnheader", { name: "FY2026" })).toBeVisible();

  // Restore the horizon so later tests see the full five-period grid.
  await horizon.fill("5");
  await horizon.press("Tab");
  await expect(driverTable.getByRole("columnheader", { name: "FY2029" })).toBeVisible();
});

test("runs a sensitivity grid", async ({ page }) => {
  await ensureScenarios(page);

  await page.getByLabel("Sensitivity row minimum").fill("0.2");
  await page.getByLabel("Sensitivity row maximum").fill("0.3");
  await page.getByLabel("Sensitivity column minimum").fill("0.3");
  await page.getByLabel("Sensitivity column maximum").fill("0.5");
  await page.getByRole("button", { name: "Run sensitivity" }).click();

  await expect(page.getByTestId("sensitivity-cell-0-0")).toBeVisible();
  await expect(page.getByTestId("sensitivity-cell-2-2")).toBeVisible();
});

test("a forecast cell cannot be typed into", async ({ page }) => {
  await ensureScenarios(page);
  const revenueCell = page.getByRole("button", { name: /Revenue, FY2025:.*Show the forecast formula/ });
  await expect(revenueCell).toBeVisible();

  await revenueCell.dblclick();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /How Revenue was forecast/ })).toBeVisible();
});
