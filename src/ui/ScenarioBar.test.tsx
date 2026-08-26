import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScenarioBar } from "./ScenarioBar";

const SCENARIOS = [
  { id: "s1", name: "Base", isBase: true },
  { id: "s2", name: "Bull", isBase: false },
  { id: "s3", name: "Bear", isBase: false },
];

function renderBar(props: Partial<Parameters<typeof ScenarioBar>[0]> = {}) {
  const onSelect = vi.fn();
  const onAdd = vi.fn();
  const onRename = vi.fn();
  const onDuplicate = vi.fn();
  const onDelete = vi.fn();
  const onHorizonChange = vi.fn();
  render(
    <ScenarioBar
      scenarios={SCENARIOS}
      activeId="s2"
      horizon={5}
      onSelect={onSelect}
      onAdd={onAdd}
      onRename={onRename}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      onHorizonChange={onHorizonChange}
      {...props}
    />,
  );
  return { onSelect, onAdd, onRename, onDuplicate, onDelete, onHorizonChange };
}

describe("ScenarioBar", () => {
  it("renders one tab per scenario", () => {
    renderBar();
    for (const s of SCENARIOS) {
      expect(screen.getByRole("tab", { name: new RegExp(s.name) })).toBeTruthy();
    }
  });

  it("marks the active scenario's tab and no other", () => {
    renderBar({ activeId: "s2" });
    expect(screen.getByRole("tab", { name: /Bull/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /Base/ }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: /Bear/ }).getAttribute("aria-selected")).toBe("false");
  });

  it("calls onSelect when a tab is clicked", () => {
    const { onSelect } = renderBar();
    fireEvent.click(screen.getByRole("tab", { name: /Bear/ }));
    expect(onSelect).toHaveBeenCalledWith("s3");
  });

  it("calls onSelect on keyboard activation (Enter)", () => {
    const { onSelect } = renderBar();
    fireEvent.keyDown(screen.getByRole("tab", { name: /Base/ }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("shows no delete control on the base scenario", () => {
    renderBar();
    expect(screen.queryByLabelText("Delete Base")).toBeNull();
    expect(screen.getByLabelText("Delete Bull")).toBeTruthy();
    expect(screen.getByLabelText("Delete Bear")).toBeTruthy();
  });

  it("clamps a horizon typed below the minimum before calling onHorizonChange", () => {
    const { onHorizonChange } = renderBar();
    const input = screen.getByLabelText(/forecast horizon/i);
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(onHorizonChange).toHaveBeenCalledWith(1);
  });

  it("clamps a horizon typed above the maximum before calling onHorizonChange", () => {
    const { onHorizonChange } = renderBar();
    const input = screen.getByLabelText(/forecast horizon/i);
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.blur(input);
    expect(onHorizonChange).toHaveBeenCalledWith(5);
  });

  it("passes an in-range horizon straight through", () => {
    const { onHorizonChange } = renderBar();
    const input = screen.getByLabelText(/forecast horizon/i);
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.blur(input);
    expect(onHorizonChange).toHaveBeenCalledWith(3);
  });

  it("adds a scenario from the inline name field", () => {
    const { onAdd } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Add scenario" }));
    const input = screen.getByLabelText("New scenario name");
    fireEvent.change(input, { target: { value: "Downside" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onAdd).toHaveBeenCalledWith("Downside");
  });

  it("duplicates the active scenario", () => {
    const { onDuplicate } = renderBar({ activeId: "s2" });
    fireEvent.click(screen.getByLabelText("Duplicate Bull"));
    expect(onDuplicate).toHaveBeenCalledWith("s2");
  });

  it("deletes a non-base scenario", () => {
    const { onDelete } = renderBar();
    fireEvent.click(screen.getByLabelText("Delete Bear"));
    expect(onDelete).toHaveBeenCalledWith("s3");
  });
});
