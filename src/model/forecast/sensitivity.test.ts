import { describe, it, expect } from "vitest";
import { sensitivityGrid, type Axis, type SensitivityCell, type SensitivityOutput } from "./sensitivity";
import { ENGINE_DRIVERS, fixtureForecastInput, historicalRows } from "./fixtures";
import type { CustomRatioInput } from "../ratios/compute";
import type { AveragingMode } from "../ratios/types";

const MODE: AveragingMode = "ending";
const NO_CUSTOM_RATIOS: CustomRatioInput[] = [];

function grid(
  rowAxis: Axis,
  columnAxis: Axis,
  output: SensitivityOutput,
  ratios: CustomRatioInput[] = NO_CUSTOM_RATIOS,
  input = fixtureForecastInput(),
) {
  return sensitivityGrid(input, rowAxis, columnAxis, output, ratios, MODE);
}

function expectOk(cell: SensitivityCell): number {
  if (cell.state !== "ok") throw new Error(`expected ok, got ${cell.state}: ${JSON.stringify(cell)}`);
  return cell.value;
}

describe("sensitivityGrid: axis shape", () => {
  it("spaces a 3-step axis evenly, inclusive of both endpoints, exactly", () => {
    const axis: Axis = { driverKey: "revenue_growth", min: 0, max: 0.1, steps: 3 };
    const flatAxis: Axis = { driverKey: "tax_rate", min: 0.2, max: 0.2, steps: 3 };
    const output: SensitivityOutput = { kind: "lineItem", key: "revenue", periodKey: "FY2025" };

    const result = grid(axis, flatAxis, output);

    expect(result.rows).toEqual([0, 0.05, 0.1]);
    expect(result.columns).toEqual([0.2, 0.2, 0.2]);
  });

  it("matches the grid shape to each axis's step count", () => {
    const rowAxis: Axis = { driverKey: "revenue_growth", min: 0, max: 0.2, steps: 5 };
    const columnAxis: Axis = { driverKey: "gross_margin", min: 0.3, max: 0.5, steps: 7 };
    const output: SensitivityOutput = { kind: "lineItem", key: "revenue", periodKey: "FY2025" };

    const result = grid(rowAxis, columnAxis, output);

    expect(result.rows).toHaveLength(5);
    expect(result.columns).toHaveLength(7);
    expect(result.cells).toHaveLength(5);
    for (const row of result.cells) expect(row).toHaveLength(7);
  });
});

describe("sensitivityGrid: the compounding result (the test that matters most)", () => {
  it("compounds revenue_growth into period-two revenue at every axis step", () => {
    // Every driver but revenue_growth is fixed at the fixture's constants (the column
    // axis is flat, so it changes nothing). Revenue in FY2024 (the base period the
    // fixture's history opens from) is 1100 (`fixtures.ts` `FY2024.revenue`).
    const revenueLast = historicalRows().FY2024.revenue;
    expect(revenueLast).toBe(1100);

    const rowAxis: Axis = { driverKey: "revenue_growth", min: 0, max: 0.2, steps: 5 };
    const flatAxis: Axis = { driverKey: "tax_rate", min: 0.2, max: 0.2, steps: 3 };
    const output: SensitivityOutput = { kind: "lineItem", key: "revenue", periodKey: "FY2026" };

    const result = grid(rowAxis, flatAxis, output);

    // Hand-computed literals, by the arithmetic shown — never produced by calling the
    // engine, and never by a second formula either: revenue[FY2026] = revenue[FY2024] *
    // (1 + g) ^ 2 worked out on paper for each g on the row axis.
    //   g = 0    -> 1100 * 1.00^2 = 1100 * 1.0000 = 1100
    //   g = 0.05 -> 1100 * 1.05^2 = 1100 * 1.1025 = 1212.75
    //   g = 0.1  -> 1100 * 1.10^2 = 1100 * 1.2100 = 1331
    //   g = 0.15 -> 1100 * 1.15^2 = 1100 * 1.3225 = 1454.75
    //   g = 0.2  -> 1100 * 1.20^2 = 1100 * 1.4400 = 1584
    const expected = [1100, 1212.75, 1331, 1454.75, 1584];
    for (let i = 0; i < result.rows.length; i++) {
      const value = expectOk(result.cells[i][0]);
      // The axis reaches every forecast period, not only the first: this is a
      // constructed-exact figure (products and powers of exact literals), so the tight
      // comparator applies, not `closeEnough`, which is for rounding noise.
      expect(value).toBeCloseTo(expected[i], 9);
    }
  });
});

describe("sensitivityGrid: a cell that fails", () => {
  it("reports state failed with the blocking finding's code, for every cell", () => {
    // A single non-annual historical period trips gate 1 (`forecast_not_annual`)
    // regardless of any driver value, so every cell in the grid fails the same way.
    const input = {
      historicalPeriods: ["Q1-2024"],
      forecastPeriods: ["FY2025", "FY2026"],
      valueAt: () => undefined,
      driverAt: () => undefined,
    };
    const rowAxis: Axis = { driverKey: "revenue_growth", min: 0, max: 0.1, steps: 3 };
    const columnAxis: Axis = { driverKey: "gross_margin", min: 0.3, max: 0.5, steps: 3 };
    const output: SensitivityOutput = { kind: "lineItem", key: "revenue", periodKey: "FY2025" };

    const result = sensitivityGrid(input, rowAxis, columnAxis, output, NO_CUSTOM_RATIOS, MODE);

    for (const row of result.cells) {
      for (const cell of row) {
        expect(cell.state).toBe("failed");
        if (cell.state === "failed") expect(cell.reason).toBe("forecast_not_annual");
        expect(cell.isBase).toBe(false);
      }
    }
  });
});

describe("sensitivityGrid: ratio outputs", () => {
  it("reports the ratio engine's own state rather than NaN when the denominator is zero", () => {
    // A custom ratio whose denominator is always exactly zero by construction, so every
    // cell reports `undefined_denominator`, never a blank and never a number.
    const zeroDenominatorRatio: CustomRatioInput = {
      key: "always_zero_denominator",
      label: "Always zero denominator",
      expression: "revenue / (interest_expense - interest_expense)",
      note: null,
    };
    const rowAxis: Axis = { driverKey: "revenue_growth", min: 0, max: 0.1, steps: 3 };
    const columnAxis: Axis = { driverKey: "gross_margin", min: 0.3, max: 0.5, steps: 3 };
    const output: SensitivityOutput = { kind: "ratio", key: "always_zero_denominator", periodKey: "FY2025" };

    const result = grid(rowAxis, columnAxis, output, [zeroDenominatorRatio]);

    for (const row of result.cells) {
      for (const cell of row) {
        expect(cell.state).toBe("failed");
        if (cell.state === "failed") expect(cell.reason).toBe("undefined_denominator");
      }
    }
  });

  it("reads a real ratio over a forecast period through computeRatios, not a second entry point", () => {
    // net_margin = net_income / revenue. FY2025's hand-worked fixture literals
    // (`fixtures.ts`) give net_income 254 and revenue 1210 at the fixture's own driver
    // values, so the base-case cell of a grid centred on those values should read
    // 254 / 1210 to the ratio engine's own precision.
    const rowAxis: Axis = { driverKey: "revenue_growth", min: 0.05, max: 0.15, steps: 3 };
    const columnAxis: Axis = { driverKey: "gross_margin", min: 0.3, max: 0.5, steps: 3 };
    const output: SensitivityOutput = { kind: "ratio", key: "net_margin", periodKey: "FY2025" };

    const result = grid(rowAxis, columnAxis, output);

    const centre = expectOk(result.cells[1][1]);
    expect(centre).toBeCloseTo(254 / 1210, 9);
  });
});

describe("sensitivityGrid: the base-case flag", () => {
  it("flags only the cell whose two axis values equal the scenario's current driver values", () => {
    // ENGINE_DRIVERS has revenue_growth 0.1 and gross_margin 0.4 (`fixtures.ts`); both
    // axes below are centred exactly on those values.
    expect(ENGINE_DRIVERS.revenue_growth).toBe(0.1);
    expect(ENGINE_DRIVERS.gross_margin).toBe(0.4);

    const rowAxis: Axis = { driverKey: "revenue_growth", min: 0.05, max: 0.15, steps: 3 };
    const columnAxis: Axis = { driverKey: "gross_margin", min: 0.3, max: 0.5, steps: 3 };
    const output: SensitivityOutput = { kind: "lineItem", key: "revenue", periodKey: "FY2025" };

    const result = grid(rowAxis, columnAxis, output);

    expect(result.rows).toEqual([0.05, 0.1, 0.15]);
    expect(result.columns).toEqual([0.3, 0.4, 0.5]);

    for (let r = 0; r < result.cells.length; r++) {
      for (let c = 0; c < result.cells[r].length; c++) {
        expect(result.cells[r][c].isBase).toBe(r === 1 && c === 1);
      }
    }
  });

  it("flags no cell when neither axis passes through the current driver values", () => {
    // 0.1 and 0.4 are not on either axis below, so the flag must be absent everywhere.
    const rowAxis: Axis = { driverKey: "revenue_growth", min: 0.2, max: 0.4, steps: 3 };
    const columnAxis: Axis = { driverKey: "gross_margin", min: 0.5, max: 0.7, steps: 3 };
    const output: SensitivityOutput = { kind: "lineItem", key: "revenue", periodKey: "FY2025" };

    const result = grid(rowAxis, columnAxis, output);

    for (const row of result.cells) {
      for (const cell of row) expect(cell.isBase).toBe(false);
    }
  });
});

describe("sensitivityGrid: wrapping driverAt", () => {
  it("never mutates the input's own driverAt: calling it directly afterwards is unaffected", () => {
    const input = fixtureForecastInput();
    const before = input.driverAt("revenue_growth", "FY2025");

    grid(
      { driverKey: "revenue_growth", min: 0, max: 1, steps: 3 },
      { driverKey: "gross_margin", min: 0, max: 1, steps: 3 },
      { kind: "lineItem", key: "revenue", periodKey: "FY2025" },
      NO_CUSTOM_RATIOS,
      input,
    );

    expect(input.driverAt("revenue_growth", "FY2025")).toBe(before);
  });

  it("applies the axis drivers to every forecast period, not only the first", () => {
    // If the wrapper only overrode the first forecast period, FY2026 revenue would
    // fall back to the fixture's own 0.1 growth for its second step, breaking the
    // hand-computed compounding result above. This pins that down directly by reading
    // both forecast periods off one axis value away from the fixture default.
    const rowAxis: Axis = { driverKey: "revenue_growth", min: 0.2, max: 0.2, steps: 3 };
    const columnAxis: Axis = { driverKey: "gross_margin", min: 0.4, max: 0.4, steps: 3 };

    const fy2025 = expectOk(
      grid(rowAxis, columnAxis, { kind: "lineItem", key: "revenue", periodKey: "FY2025" }).cells[0][0],
    );
    const fy2026 = expectOk(
      grid(rowAxis, columnAxis, { kind: "lineItem", key: "revenue", periodKey: "FY2026" }).cells[0][0],
    );

    expect(fy2025).toBeCloseTo(1100 * 1.2, 9);
    expect(fy2026).toBeCloseTo(1100 * 1.2 * 1.2, 9);
  });
});
