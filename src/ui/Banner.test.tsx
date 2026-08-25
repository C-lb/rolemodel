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
});
