import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Banner } from "./Banner";

describe("Banner", () => {
  it("renders the message and its remediation", () => {
    render(<Banner severity="blocking" title="Balance sheet does not balance" message="Gap 400." remediation="Check the three totals." />);
    expect(screen.getByText(/Gap 400/)).toBeTruthy();
    expect(screen.getByText(/Check the three totals/)).toBeTruthy();
  });

  it("marks blocking banners as alerts for screen readers", () => {
    render(<Banner severity="blocking" title="t" message="m" remediation="r" />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("uses status rather than alert for warnings", () => {
    render(<Banner severity="warning" title="t" message="m" remediation="r" />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("fires the action handler", () => {
    const onAction = vi.fn();
    render(<Banner severity="blocking" title="t" message="m" remediation="r" actionLabel="Fix it" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Fix it" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("renders no dismiss control when no handler is given", () => {
    render(<Banner severity="blocking" title="t" message="m" remediation="r" />);
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("renders an info banner with its own tone, not styled as a failure", () => {
    render(<Banner severity="info" title="t" message="m" remediation="r" />);
    const status = screen.getByRole("status");
    expect(status.className).not.toContain("red");
    expect(status.className).not.toContain("amber");
  });

  it("leaves the existing blocking and warning renders unchanged", () => {
    render(<Banner severity="blocking" title="t" message="m" remediation="r" />);
    expect(screen.getByRole("alert").className).toContain("red");
    render(<Banner severity="warning" title="t2" message="m2" remediation="r2" />);
    expect(screen.getAllByRole("status")[0].className).toContain("amber");
  });
});
