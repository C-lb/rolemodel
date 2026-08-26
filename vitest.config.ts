import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    // Vitest's implicit default is 5000ms per test and 5000ms per hook. The jsdom
    // component tests (WorkspaceRatios, RatioBuilder) do real work behind
    // `findBy*`/`waitFor` and ran into that ceiling on a loaded machine, where the
    // whole suite runs in parallel across workers: 12/12 clean in isolation, red under
    // contention. That is environmental amplification of a tight timeout, not a hang,
    // so the fix is a configured ceiling here rather than a per-call literal in each
    // test. One number, in one place, for the whole suite.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    projects: [
      {
        extends: true,
        test: { name: "node", environment: "node", include: ["src/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["src/test/setup-dom.ts"],
        },
      },
    ],
  },
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
});
