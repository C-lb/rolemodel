import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DriverGrid, type DriverRowData } from "./DriverGrid";

const PERIODS = ["FY2025", "FY2026"];

function rows(): DriverRowData[] {
  return [
    {
      key: "revenue_growth",
      cells: [
        { periodKey: "FY2025", value: 0.05, seed: { basis: "derived", note: "Derived from history." } },
        { periodKey: "FY2026", value: 0.05, seed: { basis: "derived", note: "Derived from history." } },
      ],
    },
    {
      key: "tax_rate",
      cells: [
        { periodKey: "FY2025", value: 0.3, seed: undefined },
        { periodKey: "FY2026", value: 0.21, seed: { basis: "default", note: "Fell back to the documented default." } },
      ],
    },
    {
      key: "min_cash",
      cells: [
        { periodKey: "FY2025", value: 1000 },
        { periodKey: "FY2026", value: 1000 },
      ],
    },
  ];
}

function renderGrid(props: Partial<Parameters<typeof DriverGrid>[0]> = {}) {
  const onCommit = vi.fn();
  const onFillRight = vi.fn();
  render(
    <DriverGrid
      rows={rows()}
      periods={PERIODS}
      onCommit={onCommit}
      onFillRight={onFillRight}
      {...props}
    />,
  );
  return { onCommit, onFillRight };
}

describe("DriverGrid", () => {
  it("renders one row per driver and one column per forecast period", () => {
    renderGrid();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row").length).toBeGreaterThanOrEqual(3);
    for (const period of PERIODS) {
      expect(screen.getByText(period)).toBeTruthy();
    }
    expect(screen.getByText("Revenue growth")).toBeTruthy();
    expect(screen.getByText("Tax rate")).toBeTruthy();
    expect(screen.getByText("Minimum cash")).toBeTruthy();
  });

  it("displays a percent driver as a percentage", () => {
    renderGrid();
    expect(screen.getAllByText("5.00%").length).toBe(2);
  });

  it("calls back with a decimal when a percent driver is edited", () => {
    const { onCommit } = renderGrid();
    fireEvent.doubleClick(screen.getAllByText("5.00%")[0]);
    const input = screen.getByRole<HTMLInputElement>("textbox");
    expect(input.value).toBe("5");
    fireEvent.change(input, { target: { value: "7.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("revenue_growth", "FY2025", 0.075);
  });

  it("shows a currency driver in statement units, not as a percentage", () => {
    renderGrid();
    expect(screen.getAllByText("1,000").length).toBe(2);
  });

  it("shows the basis marker only for a driver still on its seeded value", () => {
    renderGrid();
    // revenue_growth in both periods is unedited and derived: two markers.
    expect(screen.getAllByLabelText("Seeded value")).toHaveLength(3); // revenue_growth x2 + tax_rate FY2026
  });

  it("gives the basis marker a tooltip saying it was derived from history", () => {
    renderGrid();
    const markers = screen.getAllByLabelText("Seeded value");
    fireEvent.focus(markers[0]);
    expect(screen.getByText(/Derived from history/)).toBeTruthy();
  });

  it("gives the basis marker a tooltip saying it fell back to a default", () => {
    renderGrid();
    const markers = screen.getAllByLabelText("Seeded value");
    const last = markers[markers.length - 1];
    fireEvent.focus(last);
    expect(screen.getByText(/[Dd]efault/)).toBeTruthy();
  });

  it("fires fillRight with the driver key and the source period", () => {
    const { onFillRight } = renderGrid();
    fireEvent.click(screen.getByLabelText("Fill revenue growth right from FY2025"));
    expect(onFillRight).toHaveBeenCalledWith("revenue_growth", "FY2025");
  });

  it("edits dispatch through EditableCell's own contract: an unparseable entry is refused, not silently committed", () => {
    const { onCommit } = renderGrid();
    fireEvent.doubleClick(screen.getAllByText("5.00%")[0]);
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "not a number" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});
