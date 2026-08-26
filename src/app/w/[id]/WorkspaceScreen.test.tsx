import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { buildWorkspace } from "@/model/workspace";
import { ToastProvider } from "@/ui/ToastProvider";
import { WorkspaceScreen } from "./WorkspaceScreen";
import { saveOverride, clearOverride } from "@/app/actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock("@/app/actions", () => ({
  saveOverride: vi.fn(async () => ({ ok: true, data: null })),
  clearOverride: vi.fn(async () => ({ ok: true, data: null })),
}));

const save = vi.mocked(saveOverride);
const clear = vi.mocked(clearOverride);

const provenance = {
  page: 1, sheet: null, locator: "page 1", rawLabel: "Revenue", rawValue: "1,000",
  scaleFactor: 1, scaleEvidence: "", signFlipped: false,
};

/** A one-period workspace whose revenue cell is extracted, and optionally overridden on top. */
function renderScreen(override?: number) {
  const ws = buildWorkspace({
    periods: ["FY2024"],
    facts: [{ canonicalKey: "revenue", periodKey: "FY2024", value: 1000, confidence: 0.9, provenance }],
    overrides: override === undefined ? [] : [{ canonicalKey: "revenue", periodKey: "FY2024", value: override }],
  });

  render(
    <ToastProvider>
      <WorkspaceScreen
        workspaceId="w1"
        documentName="acme-10-K.pdf"
        periods={ws.periods}
        findings={ws.findings}
        statements={{ income: ws.statement("income"), balance: ws.statement("balance"), cashflow: ws.statement("cashflow") }}
      />
    </ToastProvider>,
  );
}

async function editRevenueTo(text: string, current: string) {
  fireEvent.doubleClick(screen.getByText(current));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByRole("button", { name: "Undo" });
}

beforeEach(() => {
  save.mockClear();
  clear.mockClear();
  save.mockResolvedValue({ ok: true, data: null });
  clear.mockResolvedValue({ ok: true, data: null });
});

describe("WorkspaceScreen persistence", () => {
  it("saves an edit and undoes it by clearing the override that was not there before", async () => {
    renderScreen();
    await editRevenueTo("2,000", "1,000");
    expect(save).toHaveBeenCalledWith("w1", "revenue", "FY2024", 2000);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(clear).toHaveBeenCalledWith("w1", "revenue", "FY2024"));
  });

  it("undoes an edit over an existing override by writing the earlier override back", async () => {
    renderScreen(1500);
    await editRevenueTo("2,000", "1,500");
    expect(save).toHaveBeenCalledWith("w1", "revenue", "FY2024", 2000);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("w1", "revenue", "FY2024", 1500));
    expect(clear).not.toHaveBeenCalled();
  });

  it("undoes a reset by putting the discarded override back", async () => {
    renderScreen(1500);
    fireEvent.click(screen.getByLabelText("Reset to extracted value"));
    await screen.findByRole("button", { name: "Undo" });
    expect(clear).toHaveBeenCalledWith("w1", "revenue", "FY2024");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("w1", "revenue", "FY2024", 1500));
  });

  it("raises a blocking banner, not a toast, when a save fails", async () => {
    save.mockResolvedValue({
      ok: false, code: "db_error", message: "database is locked",
      remediation: "Try again in a moment.",
    });
    renderScreen();

    fireEvent.doubleClick(screen.getByText("1,000"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "2,000" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("database is locked");
    expect(banner.textContent).toContain("Try again in a moment.");
    expect(screen.queryByText("Value updated")).toBeNull();
  });

  it("retries exactly the attempt that failed", async () => {
    save.mockResolvedValue({
      ok: false, code: "db_error", message: "database is locked", remediation: "Try again in a moment.",
    });
    renderScreen();
    fireEvent.doubleClick(screen.getByText("1,000"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "2,000" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await screen.findByRole("alert");

    save.mockResolvedValue({ ok: true, data: null });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith("w1", "revenue", "FY2024", 2000);
  });
});
