import { defineConfig } from "@playwright/test";

/**
 * Browser tests run against a dev server pointed at a throwaway data directory, seeded
 * by the global setup. Nothing here touches the real `data/`, so a browser run can never
 * disturb a workspace the user is actually working in.
 */
const DATA_DIR = "./data-e2e";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3187",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx next dev --port 3187",
    url: "http://localhost:3187",
    // Never reuse: another project's dev server on this port would be tested instead of
    // this one, and the failure reads as a missing control rather than a wrong app.
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATA_DIR },
  },
});
