import { test, expect, type Page } from "@playwright/test";
import { WORKSPACE_ID } from "./seed";

/** "18,750" -> 18750, "(1,234)" -> -1234 - the inverse of `formatMoney`. */
function parseFormattedMoney(text: string): number {
  const negative = text.trim().startsWith("(");
  const digits = text.replace(/[(),]/g, "").trim();
  const n = Number(digits);
  return negative ? -n : n;
}

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
 *
 * Residual coupling, left as-is rather than contorted away: every test that reads
 * FY2025's revenue_growth assumes it is the seeded 25% on entry. That is not this
 * file's own state - it holds only because every sibling that changes FY2025 (or a
 * period fill-right can reach) restores it before finishing. A test run alone via
 * `--grep` still passes (a fresh scenario always seeds 25%), but the full-file run
 * depends on each restoration actually running - a test that fails and skips its
 * own cleanup would leave the next one reading a value it did not expect. Fully
 * decoupling this would mean giving each test its own scenario (one `createScenario`
 * call per test) rather than sharing the workspace's Base scenario throughout, which
 * is a bigger restructuring than this fix is worth.
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
  // A blocked forecast renders its finding in an alert-role Banner and nothing else
  // (no driver grid, no statement, no sensitivity form) - asserting the role, not a
  // copy fragment, so this fails honestly if the real `forecast_missing_base` message
  // ever comes back, rather than only catching the fallback title that path never emits.
  // Scoped to <main>: Next's dev-mode overlay injects its own hidden alert region.
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);

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

  // Sets its own precondition rather than relying on FY2026 already reading the
  // seeded 25% - this test passes the same way whether it runs first or last.
  await page.getByRole("button", { name: "Revenue growth, FY2026: 25.00%" }).dblclick();
  await page.getByRole("textbox").fill("40");
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByRole("button", { name: "Revenue growth, FY2026: 40.00%" })).toBeVisible();

  await page.getByRole("button", { name: "Fill revenue growth right from FY2026" }).click();

  await expect(page.getByRole("button", { name: "Revenue growth, FY2027: 40.00%" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Revenue growth, FY2029: 40.00%" })).toBeVisible();

  // Restore FY2026-FY2029 to the seeded 25%, so no later test has to reason about
  // what this one left behind.
  await page.getByRole("button", { name: "Fill revenue growth right from FY2025" }).click();
  await expect(page.getByRole("button", { name: "Revenue growth, FY2029: 25.00%" })).toBeVisible();
});

test("fills a driver right with the keyboard alone", async ({ page }) => {
  await ensureScenarios(page);

  // Sets its own, distinctive precondition on FY2025 rather than assuming FY2026
  // already reads some earlier test's seeded or leftover value.
  await page.getByRole("button", { name: "Revenue growth, FY2025: 25.00%" }).dblclick();
  await page.getByRole("textbox").fill("33");
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByRole("button", { name: "Revenue growth, FY2025: 33.00%" })).toBeVisible();

  const fillButton = page.getByRole("button", { name: "Fill revenue growth right from FY2025" });
  await fillButton.focus();
  await expect(fillButton).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "Revenue growth, FY2026: 33.00%" })).toBeVisible();

  // Restore FY2025 (and, via fill-right, everything after it) to the seeded 25%.
  await page.getByRole("button", { name: "Revenue growth, FY2025: 33.00%" }).dblclick();
  await page.getByRole("textbox").fill("25");
  await page.getByRole("textbox").press("Enter");
  await page.getByRole("button", { name: "Fill revenue growth right from FY2025" }).click();
  await expect(page.getByRole("button", { name: "Revenue growth, FY2029: 25.00%" })).toBeVisible();
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

  // Defaults: row axis is revenue_growth, column axis is gross_margin (the first two
  // DRIVER_KEYS), output metric is revenue (the first line item), output period is
  // FY2025. This fixture's derived gross_margin is 0.4: (15,000 - |9,000|) / 15,000.
  // Row steps 0.2/0.25/0.3 and column steps 0.3/0.4/0.5 both put the scenario's own
  // current driver values on the middle step of each axis, so cell [1][1] is the base case.
  await page.getByLabel("Sensitivity row minimum").fill("0.2");
  await page.getByLabel("Sensitivity row maximum").fill("0.3");
  await page.getByLabel("Sensitivity column minimum").fill("0.3");
  await page.getByLabel("Sensitivity column maximum").fill("0.5");
  await page.getByRole("button", { name: "Run sensitivity" }).click();

  // Revenue does not depend on gross_margin, so every cell in the 25%-growth row
  // reads the same computed figure: 15,000 * 1.25 = 18,750. A grid containing only
  // failure reasons (SensitivityGrid.tsx puts the same data-testid on those) could
  // never produce this text.
  const baseCell = page.getByTestId("sensitivity-cell-1-1");
  await expect(baseCell).toContainText("18,750");
  await expect(page.getByTestId("sensitivity-cell-1-0")).toContainText("18,750");
  await expect(page.getByTestId("sensitivity-cell-1-2")).toContainText("18,750");
  // The base-case cell alone carries the outline ring class.
  await expect(baseCell).toHaveClass(/ring-sky-400/);
  await expect(page.getByTestId("sensitivity-cell-0-0")).not.toHaveClass(/ring-sky-400/);
});

test("a forecast cell cannot be typed into", async ({ page }) => {
  await ensureScenarios(page);
  const revenueCell = page.getByRole("button", { name: /Revenue, FY2025:.*Show the forecast formula/ });
  await expect(revenueCell).toBeVisible();

  await revenueCell.dblclick();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /How Revenue was forecast/ })).toBeVisible();
});

/**
 * Closes the coverage hole the server-side move opened: `WorkspaceForecast.test.tsx`'s
 * "ratios gain a forecast column" test computes its own forecast-layer workspace, so
 * it proves `WorkspaceScreen` renders whatever it is handed - it does not touch
 * `page.tsx`, which is the only place that actually assembles the forecast-layer
 * ratios workspace server-side (spec §7). `e2e/ratios.spec.ts` never opens a scenario
 * either. This is the one place both are exercised together, in a real browser,
 * against the real server.
 *
 * Self-verifying rather than hand-derived: the Forecast tab's own Revenue and Net
 * income cells are the real engine output for FY2025, read directly off the page
 * rather than recomputed by hand, then compared against what the Ratios tab's Net
 * margin card shows for the same period. If `page.tsx` failed to wire the forecast
 * layer into `computeRatios` - wrong values, wrong periods, or the column missing
 * outright - this comparison would catch it; a hand-picked expected percentage could
 * not, since deriving it by hand would just be re-implementing the engine's
 * seventeen-driver model in the test.
 */
test("a ratio gains a forecast column with a real computed value", async ({ page }) => {
  await ensureScenarios(page);

  // The button's visible text is just the formatted figure (e.g. "18,750"); the
  // fuller "Revenue, FY2025: 18,750. Show the forecast formula." sentence is its
  // aria-label, used above only to locate the right button.
  const revenueText = await page.getByRole("button", { name: /Revenue, FY2025:.*Show the forecast formula/ }).innerText();
  // Net income appears on both the income statement and as the cash-flow
  // statement's opening line, so this scopes to the income statement's table.
  const netIncomeText = await page
    .getByRole("table", { name: "Income statement" })
    .getByRole("button", { name: /Net income, FY2025:.*Show the forecast formula/ })
    .innerText();
  const revenue = parseFormattedMoney(revenueText);
  const netIncome = parseFormattedMoney(netIncomeText);
  const expectedMargin = `${((netIncome / revenue) * 100).toFixed(1)}%`;

  await page.getByRole("tab", { name: "Ratios" }).click();
  const card = page.getByRole("article").filter({ hasText: "Net margin" });
  await expect(card).toContainText("Excludes forecast periods");

  const fy2025Value = card.locator("dt", { hasText: "FY2025" }).locator("xpath=following-sibling::dd[1]");
  await expect(fy2025Value).toHaveText(expectedMargin);
});
