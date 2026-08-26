import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  it("makes plain content focusable so the help is keyboard-reachable", () => {
    render(<Tooltip label="Total sales in the period."><span>Revenue</span></Tooltip>);
    const wrapper = screen.getByText("Revenue").parentElement!;
    expect(wrapper.getAttribute("tabindex")).toBe("0");

    fireEvent.focus(wrapper);
    expect(screen.getByRole("tooltip").textContent).toBe("Total sales in the period.");
    expect(wrapper.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
  });

  it("adds no second tab stop around a control, and describes the control itself", () => {
    render(<Tooltip label="Discard your edit."><button type="button">Reset</button></Tooltip>);
    const button = screen.getByRole("button", { name: "Reset" });
    const wrapper = button.parentElement!;
    expect(wrapper.getAttribute("tabindex")).toBeNull();

    fireEvent.focus(button);
    expect(button.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    expect(wrapper.getAttribute("aria-describedby")).toBeNull();
  });

  it("treats an explicitly focusable child as a control", () => {
    render(<Tooltip label="Help."><span tabIndex={0}>Focusable</span></Tooltip>);
    expect(screen.getByText("Focusable").parentElement!.getAttribute("tabindex")).toBeNull();
  });

  it("treats a disabled control as plain content, since it cannot take focus", () => {
    render(<Tooltip label="Help."><button type="button" disabled>Save</button></Tooltip>);
    expect(screen.getByRole("button", { name: "Save" }).parentElement!.getAttribute("tabindex")).toBe("0");
  });

  it("hides the tooltip until hovered or focused", () => {
    render(<Tooltip label="Help."><span>Revenue</span></Tooltip>);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(screen.getByText("Revenue").parentElement!);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });
});
