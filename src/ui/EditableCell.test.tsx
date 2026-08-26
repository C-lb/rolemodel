import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { EditableCell } from "./EditableCell";
import type { Cell } from "@/model/workspace";

function cell(over: Partial<Cell> = {}): Cell {
  return {
    canonicalKey: "revenue", periodKey: "FY2024", value: 1000, source: "extracted",
    extractedValue: 1000, confidence: 0.9, provenance: undefined, ...over,
  };
}

function renderCell(props: Partial<Parameters<typeof EditableCell>[0]> = {}) {
  const onCommit = vi.fn();
  const onReset = vi.fn();
  const onInspect = vi.fn();
  render(
    <table><tbody><tr>
      <EditableCell cell={cell()} onCommit={onCommit} onReset={onReset} onInspect={onInspect} {...props} />
    </tr></tbody></table>,
  );
  return { onCommit, onReset, onInspect };
}

/** A real pointer click carries a detail count; a keyboard-activated one does not. */
const pointerClick = (el: Element, detail = 1) => fireEvent.click(el, { detail });

afterEach(() => {
  vi.useRealTimers();
});

describe("EditableCell", () => {
  it("shows a formatted value", () => {
    renderCell();
    expect(screen.getByText("1,000")).toBeTruthy();
  });

  it("opens an editor on double click and commits a parsed value", () => {
    const { onCommit } = renderCell();
    fireEvent.doubleClick(screen.getByText("1,000"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "(2,500)" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(-2500);
  });

  it("refuses to commit an unparseable value and marks the field invalid", () => {
    const { onCommit } = renderCell();
    fireEvent.doubleClick(screen.getByText("1,000"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "roughly 900" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
  });

  it("discards the edit on Escape, including the blur that closing the editor causes", () => {
    const { onCommit } = renderCell();
    fireEvent.doubleClick(screen.getByText("1,000"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "9,999" } });
    // Escape blurs the input, and blur is what normally commits. It must not here.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText("1,000")).toBeTruthy();
  });

  it("commits when the editor loses focus to something else", () => {
    const { onCommit } = renderCell();
    fireEvent.doubleClick(screen.getByText("1,000"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "1,250" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(1250);
  });

  it("offers a reset control only for overridden cells", () => {
    renderCell();
    expect(screen.queryByLabelText("Reset to extracted value")).toBeNull();
  });

  it("resets an overridden cell back to the extracted figure", () => {
    const { onReset } = renderCell({ cell: cell({ source: "override", value: 1200 }) });
    fireEvent.click(screen.getByLabelText("Reset to extracted value"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("flags a low-confidence extracted cell", () => {
    renderCell({ cell: cell({ confidence: 0.2 }) });
    expect(screen.getByText("Low confidence")).toBeTruthy();
  });

  it("inspects on a single pointer click, once the double-click window has passed", () => {
    vi.useFakeTimers();
    const { onInspect } = renderCell();
    pointerClick(screen.getByText("1,000"));
    expect(onInspect).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(onInspect).toHaveBeenCalledTimes(1);
  });

  it("edits without inspecting when the two clicks land as a double click", () => {
    vi.useFakeTimers();
    const { onInspect } = renderCell();
    const figure = screen.getByText("1,000");
    pointerClick(figure, 1);
    pointerClick(figure, 2);
    fireEvent.doubleClick(figure);
    act(() => { vi.advanceTimersByTime(300); });
    expect(onInspect).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("inspects immediately when the figure is activated from the keyboard", () => {
    const { onInspect } = renderCell();
    fireEvent.click(screen.getByText("1,000"), { detail: 0 });
    expect(onInspect).toHaveBeenCalledTimes(1);
  });

  it("opens the editor when Enter is pressed on the focused figure", () => {
    const { onInspect } = renderCell();
    fireEvent.keyDown(screen.getByText("1,000"), { key: "Enter" });
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(onInspect).not.toHaveBeenCalled();
  });

  it("returns focus to the figure when the editor closes", () => {
    renderCell();
    const figure = screen.getByText("1,000");
    fireEvent.doubleClick(figure);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByText("1,000"));
  });

  it("seeds the editor with the raw figure rather than the formatted one", () => {
    renderCell({ cell: cell({ value: -2500 }) });
    fireEvent.doubleClick(screen.getByText("(2,500)"));
    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("-2500");
  });
});
