import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import * as taxonomy from "../taxonomy";
import * as periods from "../periods";
import * as drivers from "./drivers";
import { runForecast, type ForecastInput, type ForecastResult } from "./engine";
import { EXPECTED_FORECAST, fixtureForecastInput, plugForecastInput } from "./fixtures";

/**
 * Spec section 5.5's committed mutation check.
 *
 * "The test suite must include a mutation check in the spirit of the project's existing
 * guard tests: a deliberately broken engine, for instance one that drops the
 * working-capital delta from cash from operations, must make the invariant test fail. A
 * guard that has never been seen to go red cannot be trusted."
 *
 * `engine.test.ts` only exercises `articulates()` against literals, which proves the
 * COMPARATOR is tight. It does not prove the engine's own invariant fires. The four
 * mutations were run by hand during implementation and recorded in a gitignored ledger,
 * where CI cannot see them, which is exactly the position the spec warns about.
 *
 * WHAT THIS DOES. It reads `engine.ts`'s own source, applies one textual mutation,
 * transpiles the result in memory with the real modules injected, and runs the mutant
 * through the real fixtures. The invariant that goes red is therefore the engine's, in
 * its own code, not a reimplementation of it in a test. Nothing about the engine was
 * restructured to make this possible: there is no injected hook, no exported internal,
 * and no seam that a future edit could weaken. `purity.test.ts` already reads and parses
 * model source with the TypeScript compiler; this is the same technique pointed at a
 * different property.
 *
 * Each mutation asserts that it CHANGED the source. An edit to `engine.ts` that moves or
 * rewrites a mutated line turns this file red rather than quietly reducing it to a test
 * that recompiles the engine unmodified and asserts nothing.
 */

const ENGINE_PATH = path.join(process.cwd(), "src", "model", "forecast", "engine.ts");
const ENGINE_SOURCE = fs.readFileSync(ENGINE_PATH, "utf8");

/**
 * The engine's runtime imports, by the specifier it writes them under. Type-only
 * imports (`./seed`, `../validate`) are erased by the transpiler and never looked up,
 * so a missing entry here is a hard error rather than an undefined that limps on.
 */
const INJECTED: Record<string, unknown> = {
  "../taxonomy": taxonomy,
  "../periods": periods,
  "./drivers": drivers,
};

interface EngineModule {
  runForecast(input: ForecastInput): ForecastResult;
}

/** Compiles a mutated copy of the engine and returns its exports. */
function loadMutant(source: string): EngineModule {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
    fileName: "engine.mutant.ts",
  }).outputText;

  // Named `mutantModule`, not `module`: Next's lint rule forbids assigning to a
  // variable called `module`, and the CommonJS wrapper below takes it as a parameter
  // anyway, so the local name is free.
  const mutantModule = { exports: {} as Record<string, unknown> };
  const require = (specifier: string): unknown => {
    const injected = INJECTED[specifier];
    if (injected === undefined) {
      throw new Error(`the mutation harness has no module for "${specifier}"; add it to INJECTED`);
    }
    return injected;
  };

  new Function("require", "exports", "module", js)(require, mutantModule.exports, mutantModule);
  const mutant = mutantModule.exports as unknown as EngineModule;
  expect(typeof mutant.runForecast, "the mutant did not export runForecast").toBe("function");
  return mutant;
}

/** Applies one exact textual replacement, and refuses to pretend it happened if it did not. */
function mutate(find: string, replace: string): EngineModule {
  const occurrences = ENGINE_SOURCE.split(find).length - 1;
  expect(
    occurrences,
    `the mutation target is not in engine.ts exactly once, so this mutation no longer bites:\n${find}`,
  ).toBe(1);
  return loadMutant(ENGINE_SOURCE.replace(find, replace));
}

/** The invariant's own verdict: a blocking articulation finding, and no rendered cells. */
function articulationBroke(result: ForecastResult): boolean {
  return !result.ok
    && result.cells.length === 0
    && result.findings.some((f) => f.code === "forecast_articulation_broken" && f.severity === "blocking");
}

describe("the mutation harness itself", () => {
  it("recompiles the unmutated engine and reproduces its output exactly", () => {
    // Without this, every assertion below could be passing because the harness never
    // runs anything, or runs something that fails for a reason of its own.
    const rebuilt = loadMutant(ENGINE_SOURCE);
    const real = runForecast(fixtureForecastInput());
    const mutantResult = rebuilt.runForecast(fixtureForecastInput());

    expect(mutantResult.ok).toBe(true);
    expect(real.ok).toBe(true);
    for (const period of ["FY2025", "FY2026"]) {
      for (const key of Object.keys(EXPECTED_FORECAST[period])) {
        expect(mutantResult.valueAt(key, period), `${key} in ${period}`)
          .toBe(real.valueAt(key, period));
      }
    }
  });

  it("refuses a mutation whose target no longer exists in the engine", () => {
    expect(() => mutate("a line engine.ts does not contain", "x")).toThrow();
  });
});

describe("the articulation invariant, mutation-tested", () => {
  it("goes red when change_in_working_capital is dropped from cash from operations", () => {
    // Mutation 1. Receivables, inventory and payables still move on the balance sheet
    // while the cash they consumed never leaves, so assets are out by the delta.
    const mutant = mutate(
      `    put(
      "change_in_working_capital",
      -deltaWorkingCapital,`,
      `    put(
      "change_in_working_capital",
      0,`,
    );
    expect(articulationBroke(mutant.runForecast(fixtureForecastInput()))).toBe(true);
  });

  it("goes red when stock_based_compensation is dropped from common_stock_apic", () => {
    // Mutation 2. SBC is still added back in operating cash flow, so cash carries it
    // and equity does not.
    const mutant = mutate(
      `      open("common_stock_apic") + stockBasedCompensation,`,
      `      open("common_stock_apic"),`,
    );
    expect(articulationBroke(mutant.runForecast(fixtureForecastInput()))).toBe(true);
  });

  it("goes red when dividends_paid is dropped from retained_earnings", () => {
    // Mutation 3. The dividend leaves cash and never leaves equity.
    const mutant = mutate(
      `      open("retained_earnings") + netIncome + dividendsPaid,`,
      `      open("retained_earnings") + netIncome,`,
    );
    expect(articulationBroke(mutant.runForecast(fixtureForecastInput()))).toBe(true);
  });

  it("is tight enough to catch the smallest of the three, in the plug fixture too", () => {
    // The guard's sensitivity must come from the engine, not from how big the fixture
    // happens to be. `closeEnough` would have allowed roughly 7 units on this balance
    // sheet, which is larger than the working-capital movement mutation 1 introduces.
    const mutant = mutate(
      `      open("retained_earnings") + netIncome + dividendsPaid,`,
      `      open("retained_earnings") + netIncome,`,
    );
    expect(articulationBroke(mutant.runForecast(plugForecastInput({ drivers: { dividend_payout: 0.01 } })))).toBe(true);
  });

  it("does NOT catch depreciation taken on the wrong PP&E base, and that is not a hole", () => {
    // Mutation 4, encoded honestly rather than forced.
    //
    // Depreciation is an operating ADDBACK in this model: the taxonomy carries it on
    // the cash-flow statement only. Charging it on a larger base adds exactly as much
    // to cash from operations as it removes from PP&E, so the two sides move together
    // and the balance sheet still closes. The invariant is blind to this rule by
    // construction, and no tightening of the comparator would change that.
    //
    // Its guard is the dedicated opening-balance assertion in engine.test.ts, which
    // pins depreciation to `property_plant_equipment[P] * depreciation_pct_ppe` against
    // hand-computed literals. This test asserts BOTH halves: the invariant stays green,
    // and the figure is wrong, which is what makes the other test load-bearing.
    const mutant = mutate(
      `      open("property_plant_equipment") * d("depreciation_pct_ppe"),`,
      `      (open("property_plant_equipment") + Math.abs(revenue * d("capex_pct_revenue"))) * d("depreciation_pct_ppe"),`,
    );
    const result = mutant.runForecast(fixtureForecastInput());

    expect(result.ok, "the invariant is not what catches this mutation").toBe(true);
    expect(articulationBroke(result)).toBe(false);
    // 500 opening PP&E at 10 per cent is 50. On a closing-style base it is not.
    expect(result.valueAt("depreciation_amortisation", "FY2025"))
      .not.toBe(EXPECTED_FORECAST.FY2025.depreciation_amortisation);
    expect(runForecast(fixtureForecastInput()).valueAt("depreciation_amortisation", "FY2025"))
      .toBe(EXPECTED_FORECAST.FY2025.depreciation_amortisation);
  });
});
