import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { buildWorkspace } from "@/model/workspace";
import { StatementTable, droppedRowKey } from "./StatementTable";

const provenance = {
  page: 1, sheet: null, locator: "page 1", rawLabel: "Revenue", rawValue: "1,000",
  scaleFactor: 1, scaleEvidence: "", signFlipped: false,
};

/** One income statement holding a single figure, so most of its rows are empty. */
function renderIncome(revealEmptyRows: boolean) {
  const ws = buildWorkspace({
    periods: ["FY2024"],
    facts: [{ canonicalKey: "revenue", periodKey: "FY2024", value: 1000, confidence: 0.9, provenance }],
    overrides: [],
  });

  render(
    <DndContext id="test">
      <StatementTable
        title="Income statement"
        rows={ws.statement("income")}
        periods={ws.periods}
        onEdit={vi.fn()}
        onReset={vi.fn()}
        onInspect={vi.fn()}
        revealEmptyRows={revealEmptyRows}
      />
    </DndContext>,
  );
  return ws.statement("income");
}

describe("StatementTable", () => {
  it("shows only the lines that hold a figure at rest", () => {
    renderIncome(false);
    expect(screen.getByRole("rowheader", { name: "Revenue" })).toBeTruthy();
    expect(screen.queryByRole("rowheader", { name: "Interest expense" })).toBeNull();
  });

  it("shows every line while a figure is being dragged, so an empty one can take it", () => {
    const rows = renderIncome(true);
    expect(screen.getAllByRole("rowheader")).toHaveLength(rows.length);
    expect(screen.getByRole("rowheader", { name: "Interest expense" })).toBeTruthy();
  });

  it("stays hidden when the statement is empty, unless a drag needs its lines", () => {
    const empty = buildWorkspace({ periods: ["FY2024"], facts: [], overrides: [] });
    const table = (reveal: boolean) => (
      <DndContext id="test">
        <StatementTable
          title="Cash flow"
          rows={empty.statement("cashflow")}
          periods={empty.periods}
          onEdit={vi.fn()}
          onReset={vi.fn()}
          onInspect={vi.fn()}
          revealEmptyRows={reveal}
        />
      </DndContext>
    );

    const { unmount } = render(table(false));
    expect(screen.queryByRole("table")).toBeNull();
    unmount();

    render(table(true));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "Capital expenditures" })).toBeTruthy();
  });
});

describe("droppedRowKey", () => {
  it("reads the line item out of a row drop target", () => {
    expect(droppedRowKey("row:inventory")).toBe("inventory");
  });

  it("refuses anything that is not a row drop target", () => {
    expect(droppedRowKey(undefined)).toBeNull();
    expect(droppedRowKey("inventory")).toBeNull();
    expect(droppedRowKey("chip:fact-1")).toBeNull();
    expect(droppedRowKey(7)).toBeNull();
  });

  it("refuses a row target with no line item behind it", () => {
    expect(droppedRowKey("row:")).toBeNull();
  });
});
