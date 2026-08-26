import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { buildWorkspace } from "@/model/workspace";
import { ToastProvider } from "@/ui/ToastProvider";
import { WorkspaceScreen } from "./WorkspaceScreen";
import { saveOverride, clearOverride, remapLineItem } from "@/app/actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock("@/app/actions", () => ({
  saveOverride: vi.fn(async () => ({ ok: true, data: null })),
  clearOverride: vi.fn(async () => ({ ok: true, data: null })),
  remapLineItem: vi.fn(async () => ({ ok: true, data: null })),
}));

const save = vi.mocked(saveOverride);
const clear = vi.mocked(clearOverride);
const remap = vi.mocked(remapLineItem);

const unmappedFact = {
  id: "fact-9", label: "Restructuring reserve", periodKey: "FY2024",
  value: 50, page: 4, rawValue: "50",
};

const provenance = {
  page: 1, sheet: null, locator: "page 1", rawLabel: "Revenue", rawValue: "1,000",
  scaleFactor: 1, scaleEvidence: "", signFlipped: false,
};

/** A one-period workspace whose revenue cell is extracted, and optionally overridden on top. */
function renderScreen(override?: number, unmapped: (typeof unmappedFact)[] = []) {
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
        unmapped={unmapped}
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
  remap.mockClear();
  remap.mockResolvedValue({ ok: true, data: null });
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

describe("WorkspaceScreen remapping", () => {
  const moveLabel = "Move Restructuring reserve to a line item";

  it("lists an unmapped figure with its raw label, period, value and page", () => {
    renderScreen(undefined, [unmappedFact]);
    expect(screen.getByText("Restructuring reserve")).toBeTruthy();
    expect(screen.getByText(/FY2024 · 50 · page 4/)).toBeTruthy();
  });

  it("shows the printed figure alongside the scaled one when they read differently", () => {
    renderScreen(undefined, [{ ...unmappedFact, value: 50000, rawValue: "50" }]);
    expect(screen.getByText(/50,000 \(50 as printed\)/)).toBeTruthy();
  });

  it("remaps from the dropdown, with no pointer involved", async () => {
    renderScreen(undefined, [unmappedFact]);
    fireEvent.change(screen.getByLabelText(moveLabel), { target: { value: "inventory" } });
    await waitFor(() => expect(remap).toHaveBeenCalledWith("w1", "fact-9", "inventory"));
    await screen.findByText("Line item moved");
  });

  it("puts a remapped figure back when the move is undone", async () => {
    renderScreen(undefined, [unmappedFact]);
    fireEvent.change(screen.getByLabelText(moveLabel), { target: { value: "inventory" } });
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(remap).toHaveBeenCalledWith("w1", "fact-9", "unmapped"));
  });

  it("shows the refusal as a toast and does not claim the move happened", async () => {
    remap.mockResolvedValue({
      ok: false, code: "remap_failed",
      message: "Inventory already has a value for FY2024. Clear it before moving this line there.",
      remediation: "Pick a different target line, or clear the existing value there first.",
    });
    renderScreen(undefined, [unmappedFact]);
    fireEvent.change(screen.getByLabelText(moveLabel), { target: { value: "inventory" } });

    await screen.findByText(/Inventory already has a value for FY2024/);
    expect(screen.queryByText("Line item moved")).toBeNull();
  });

  it("shows no drawer when every figure was mapped", () => {
    renderScreen();
    expect(screen.queryByText(/could not be mapped/)).toBeNull();
  });
});
