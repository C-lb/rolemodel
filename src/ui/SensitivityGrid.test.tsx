import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SensitivityGrid } from "./SensitivityGrid";
import type { SensitivityResult } from "@/model/forecast/sensitivity";

function result(): SensitivityResult {
  return {
    rows: [0.0, 0.05, 0.1],
    columns: [0.3, 0.35, 0.4],
    cells: [
      [
        { state: "ok", value: 100, isBase: false },
        { state: "ok", value: 110, isBase: false },
        { state: "ok", value: 120, isBase: false },
      ],
      [
        { state: "ok", value: 130, isBase: false },
        { state: "ok", value: 140, isBase: true },
        { state: "failed", reason: "forecast_articulation_broken", isBase: false },
      ],
      [
        { state: "ok", value: 150, isBase: false },
        { state: "ok", value: 160, isBase: false },
        { state: "ok", value: 170, isBase: false },
      ],
    ],
  };
}

function renderGrid(props: Partial<Parameters<typeof SensitivityGrid>[0]> = {}) {
  render(
    <SensitivityGrid
      result={result()}
      rowLabel="Revenue growth"
      columnLabel="Gross margin"
      rowUnit="percent"
      columnUnit="percent"
      formatValue={(v) => `${v.toFixed(0)}`}
      {...props}
    />,
  );
}

describe("SensitivityGrid", () => {
  it("shows the two axis labels", () => {
    renderGrid();
    expect(screen.getByText("Revenue growth")).toBeTruthy();
    expect(screen.getByText("Gross margin")).toBeTruthy();
  });

  it("formats axis values with the given driver unit", () => {
    renderGrid();
    expect(screen.getByText("0.00%")).toBeTruthy();
    expect(screen.getByText("30.00%")).toBeTruthy();
  });

  it("outlines the base cell", () => {
    renderGrid();
    const base = screen.getByTestId("sensitivity-cell-1-1");
    expect(base.className).toMatch(/ring|outline|border-sky/);
  });

  it("does not outline a non-base cell the same way", () => {
    renderGrid();
    const notBase = screen.getByTestId("sensitivity-cell-0-0");
    const base = screen.getByTestId("sensitivity-cell-1-1");
    expect(notBase.className).not.toBe(base.className);
  });

  it("shows a failed cell's reason", () => {
    renderGrid();
    const failed = screen.getByTestId("sensitivity-cell-1-2");
    expect(failed.textContent).toMatch(/articulation/);
  });

  it("conveys shading through more than hue: every ok, non-base cell carries a non-colour attribute", () => {
    renderGrid();
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (r === 1 && c === 1) continue; // base cell, excluded below
        if (r === 1 && c === 2) continue; // failed cell, no shading to speak of
        const cell = screen.getByTestId(`sensitivity-cell-${r}-${c}`);
        expect(cell.hasAttribute("data-direction")).toBe(true);
        expect(cell.getAttribute("data-direction")).not.toBe("");
      }
    }
  });

  it("gives cells on opposite sides of the base different non-colour direction markers", () => {
    renderGrid();
    const low = screen.getByTestId("sensitivity-cell-0-0"); // 100, below base (140)
    const high = screen.getByTestId("sensitivity-cell-2-2"); // 170, above base (140)
    expect(low.getAttribute("data-direction")).not.toBe(high.getAttribute("data-direction"));
  });

  it("carries a data-magnitude attribute, a second non-colour channel independent of direction", () => {
    renderGrid();
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (r === 1 && c === 1) continue; // base
        if (r === 1 && c === 2) continue; // failed
        const cell = screen.getByTestId(`sensitivity-cell-${r}-${c}`);
        expect(cell.hasAttribute("data-magnitude")).toBe(true);
      }
    }
  });

  it("gives a cell further from the base a larger direction glyph than one closer to it, a size step independent of colour", () => {
    renderGrid();
    // base is 140 (row 1, col 1). (0,0)=100 is 40 away, the furthest cell in the grid;
    // (2,0)=150 is only 10 away. Distance is what should separate their glyph size.
    const far = screen.getByTestId("sensitivity-cell-0-0").querySelector("svg")!;
    const near = screen.getByTestId("sensitivity-cell-2-0").querySelector("svg")!;
    expect(far.getAttribute("class")).not.toBe(near.getAttribute("class"));
  });

  it("shades above-base and below-base cells with different hues, not the same hue at different opacities", () => {
    renderGrid();
    const above = screen.getByTestId("sensitivity-cell-2-2") as HTMLElement; // 170, above base
    const below = screen.getByTestId("sensitivity-cell-0-0") as HTMLElement; // 100, below base
    const aboveColor = above.style.backgroundColor;
    const belowColor = below.style.backgroundColor;
    expect(aboveColor).not.toBe("");
    expect(belowColor).not.toBe("");
    // Different hue, not just different opacity of the same one: strip the alpha
    // channel and confirm the RGB triples themselves differ.
    const rgbOnly = (c: string) => c.replace(/rgba?\(([^)]+)\)/, (_, inner) => inner.split(",").slice(0, 3).join(","));
    expect(rgbOnly(aboveColor)).not.toBe(rgbOnly(belowColor));
  });

  it("formats cell values with the caller-supplied formatter", () => {
    renderGrid();
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.getByText("170")).toBeTruthy();
  });
});
