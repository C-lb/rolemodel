import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ForecastStatement, type ForecastStatementRow } from "./ForecastStatement";

function rows(): ForecastStatementRow[] {
  return [
    {
      key: "revenue",
      label: "Revenue",
      cells: [
        { kind: "historical", periodKey: "FY2023", value: 900 },
        { kind: "historical", periodKey: "FY2024", value: 1000 },
        {
          kind: "forecast",
          periodKey: "FY2025",
          value: 1050,
          formula: "revenue[FY2024] * (1 + revenue_growth)",
          inputs: [{ label: "Revenue, FY2024", value: 1000 }, { label: "Revenue growth", value: 0.05 }],
        },
      ],
    },
    {
      key: "acquisitions",
      label: "Acquisitions",
      heldAtZero: true,
      cells: [
        { kind: "historical", periodKey: "FY2023", value: -50 },
        { kind: "historical", periodKey: "FY2024", value: 0 },
        { kind: "forecast", periodKey: "FY2025", value: 0, formula: "held at zero", inputs: [] },
      ],
    },
    {
      key: "short_term_investments",
      label: "Short-term investments",
      heldFlat: true,
      cells: [
        { kind: "historical", periodKey: "FY2023", value: 200 },
        { kind: "historical", periodKey: "FY2024", value: 220 },
        { kind: "forecast", periodKey: "FY2025", value: 220, formula: "held flat", inputs: [] },
      ],
    },
  ];
}

function renderStatement(props: Partial<Parameters<typeof ForecastStatement>[0]> = {}) {
  const onExplain = vi.fn();
  render(<ForecastStatement title="Income statement" rows={rows()} onExplain={onExplain} {...props} />);
  return { onExplain };
}

describe("ForecastStatement", () => {
  it("visually separates historical and forecast columns", () => {
    renderStatement();
    const seam = screen.getByTestId("forecast-seam-FY2025");
    expect(seam.className).toMatch(/border-l/);
  });

  it("shows historical and forecast values", () => {
    renderStatement();
    expect(screen.getByText("900")).toBeTruthy();
    expect(screen.getByText("1,000")).toBeTruthy();
    expect(screen.getByText("1,050")).toBeTruthy();
  });

  it("exposes no edit affordance on a forecast cell: no textbox appears after the interactions that would open one on an editable cell", () => {
    renderStatement();
    const forecastCell = screen.getByText("1,050");
    fireEvent.doubleClick(forecastCell);
    fireEvent.keyDown(forecastCell, { key: "Enter" });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("calls onExplain with the cell's formula and inputs when a forecast cell is clicked", () => {
    const { onExplain } = renderStatement();
    fireEvent.click(screen.getByText("1,050"));
    expect(onExplain).toHaveBeenCalledWith(
      expect.objectContaining({ key: "revenue" }),
      expect.objectContaining({
        periodKey: "FY2025",
        formula: "revenue[FY2024] * (1 + revenue_growth)",
        inputs: [{ label: "Revenue, FY2024", value: 1000 }, { label: "Revenue growth", value: 0.05 }],
      }),
    );
  });

  it("calls onExplain on keyboard activation of a forecast cell", () => {
    const { onExplain } = renderStatement();
    fireEvent.keyDown(screen.getByText("1,050"), { key: "Enter" });
    expect(onExplain).toHaveBeenCalledTimes(1);
  });

  it("does not call onExplain for a historical cell, which has no click handler", () => {
    const { onExplain } = renderStatement();
    fireEvent.click(screen.getByText("1,000"));
    expect(onExplain).not.toHaveBeenCalled();
  });

  it("labels a held-at-zero row", () => {
    renderStatement();
    expect(screen.getByText("held at zero")).toBeTruthy();
  });

  it("labels a held-flat row", () => {
    renderStatement();
    expect(screen.getByText("held flat")).toBeTruthy();
  });

  it("still separates a ragged row's own seam correctly, rather than borrowing the first row's index", () => {
    // This row's forecast columns start one earlier than every other row's (index 1,
    // not 2): its own historical/forecast border must sit there, not at index 2.
    const ragged: ForecastStatementRow = {
      key: "ragged",
      label: "Ragged line",
      cells: [
        { kind: "historical", periodKey: "FY2023", value: 10 },
        { kind: "forecast", periodKey: "FY2024", value: 20, formula: "f", inputs: [] },
        { kind: "forecast", periodKey: "FY2025", value: 30, formula: "f", inputs: [] },
      ],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<ForecastStatement title="Income statement" rows={[...rows(), ragged]} onExplain={vi.fn()} />);
    const raggedRow = screen.getByText("Ragged line").closest("tr")!;
    const cells = raggedRow.querySelectorAll("td");
    expect(cells[0].className).not.toMatch(/border-l/); // FY2023, historical, no seam here
    expect(cells[1].className).toMatch(/border-l/); // FY2024, this row's own seam
    warn.mockRestore();
  });
});
