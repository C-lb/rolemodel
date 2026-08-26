import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@/ui/ToastProvider";
import { WorkspaceScreen } from "./WorkspaceScreen";
import { computeRatios } from "@/model/ratios/compute";
import { fixtureWorkspace } from "@/model/ratios/fixtures";
import type { AveragingMode } from "@/model/ratios/types";
import { setAveraging, saveRatio, deleteRatio, explainRatio } from "@/app/actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock("@/app/actions", () => ({
  saveOverride: vi.fn(async () => ({ ok: true, data: null })),
  clearOverride: vi.fn(async () => ({ ok: true, data: null })),
  remapLineItem: vi.fn(async () => ({ ok: true, data: null })),
  setAveraging: vi.fn(async () => ({ ok: true, data: null })),
  saveRatio: vi.fn(async () => ({ ok: true, data: { key: "rd_intensity" } })),
  deleteRatio: vi.fn(async () => ({ ok: true, data: null })),
  explainRatio: vi.fn(async () => ({
    ok: true,
    data: { text: "Margin held flat as both sides grew.", declined: false, reason: null, cached: false },
  })),
}));

const averaging = vi.mocked(setAveraging);
const save = vi.mocked(saveRatio);
const remove = vi.mocked(deleteRatio);
const explain = vi.mocked(explainRatio);

function renderScreen(
  mode: AveragingMode = "ending",
  custom: { key: string; label: string; expression: string; note: string | null }[] = [],
) {
  const ws = fixtureWorkspace();
  render(
    <ToastProvider>
      <WorkspaceScreen
        workspaceId="w1"
        documentName="acme-10-K.pdf"
        periods={ws.periods}
        findings={ws.findings}
        unmapped={[]}
        statements={{ income: ws.statement("income"), balance: ws.statement("balance"), cashflow: ws.statement("cashflow") }}
        ratios={computeRatios({ workspace: ws, mode, custom })}
        customRatios={custom}
        averagingMode={mode}
      />
    </ToastProvider>,
  );
}

const openRatios = () => fireEvent.click(screen.getByRole("tab", { name: /ratios/i }));

/** The card for one ratio. Its label also appears in the DuPont line, which is not a card. */
function cardFor(label: string): HTMLElement {
  for (const node of screen.getAllByText(label)) {
    const card = node.closest("article");
    if (card) return card;
  }
  throw new Error(`no card for "${label}"`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the ratios view", () => {
  it("is not the view the screen opens on", () => {
    renderScreen();
    expect(screen.queryByText("Net margin")).toBeNull();
  });

  it("shows the five families once opened", () => {
    renderScreen();
    openRatios();
    for (const family of ["Liquidity", "Leverage", "Efficiency", "Profitability", "Coverage"]) {
      expect(screen.getByRole("button", { name: new RegExp(family, "i") })).toBeTruthy();
    }
  });

  it("narrows to the core twelve and back again", () => {
    renderScreen();
    openRatios();
    expect(screen.getAllByRole("article")).toHaveLength(25);

    fireEvent.click(screen.getByRole("button", { name: /core 12/i }));
    expect(screen.getAllByRole("article")).toHaveLength(12);
    expect(screen.queryByText("Cash ratio")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /all 25/i }));
    expect(screen.getAllByRole("article")).toHaveLength(25);
  });

  it("shows the DuPont decomposition", () => {
    renderScreen();
    openRatios();
    expect(screen.getByText(/DuPont/i)).toBeTruthy();
  });
});

describe("the averaging toggle", () => {
  it("saves the choice", async () => {
    renderScreen("ending");
    openRatios();
    fireEvent.click(screen.getByRole("button", { name: /average balances/i }));
    await waitFor(() => expect(averaging).toHaveBeenCalledWith("w1", "average"));
  });

  it("says which convention is in force", () => {
    renderScreen("average");
    openRatios();
    expect((screen.getByRole("button", { name: /average balances/i }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the generated reading", () => {
  it("asks for one and shows what comes back", async () => {
    renderScreen();
    openRatios();
    const card = cardFor("Net margin");

    fireEvent.click(within(card).getByRole("button", { name: /explain the trend/i }));
    await waitFor(() => expect(explain).toHaveBeenCalledWith("w1", "net_margin"));
    expect(await screen.findByText(/held flat/)).toBeTruthy();
  });

  it("keeps the numbers when the reading fails", async () => {
    explain.mockResolvedValueOnce({
      ok: false,
      code: "interpretation_failed",
      message: "The reading could not be generated.",
      remediation: "Try again.",
    });
    renderScreen();
    openRatios();
    const card = cardFor("Net margin");

    fireEvent.click(within(card).getByRole("button", { name: /explain the trend/i }));
    expect(await screen.findByText(/could not be generated/)).toBeTruthy();
    expect(within(card).getAllByText("14.0%").length).toBeGreaterThan(0);
  });
});

describe("custom ratios", () => {
  it("opens the builder and saves what it hands back", async () => {
    renderScreen();
    openRatios();
    fireEvent.click(screen.getByRole("button", { name: /new ratio/i }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "R&D intensity" } });
    fireEvent.change(screen.getByLabelText("Expression"), {
      target: { value: "research_development / revenue" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save ratio$/i }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("w1", {
        label: "R&D intensity",
        expression: "research_development / revenue",
        note: null,
      }),
    );
  });

  it("shows what the server refused rather than closing the builder", async () => {
    save.mockResolvedValueOnce({
      ok: false,
      code: "cycle",
      message: "This makes Alpha depend on Beta, which refers back to itself.",
      remediation: "Point it somewhere else.",
    });
    renderScreen();
    openRatios();
    fireEvent.click(screen.getByRole("button", { name: /new ratio/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alpha" } });
    fireEvent.change(screen.getByLabelText("Expression"), { target: { value: "revenue / total_assets" } });
    fireEvent.click(screen.getByRole("button", { name: /^save ratio$/i }));

    expect(await screen.findByText(/refers back to itself/)).toBeTruthy();
    expect(screen.getByLabelText("Expression")).toBeTruthy();
  });

  it("deletes one with an undo in the toast", async () => {
    renderScreen("ending", [
      { key: "rd_intensity", label: "R&D intensity", expression: "operating_expenses / revenue", note: null },
    ]);
    openRatios();
    const card = cardFor("R&D intensity");

    fireEvent.click(within(card).getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("w1", "rd_intensity"));

    const undo = await screen.findByRole("button", { name: "Undo" });
    fireEvent.click(undo);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("w1", {
        label: "R&D intensity",
        expression: "operating_expenses / revenue",
        note: null,
      }),
    );
  });
});

describe("provenance from a ratio", () => {
  it("opens the panel for the component that was clicked", async () => {
    renderScreen();
    openRatios();
    const card = cardFor("Net margin");

    fireEvent.click(within(card).getByRole("button", { name: /show inputs/i }));
    fireEvent.click(within(card).getAllByRole("button", { name: /Revenue, FY2024/i })[0]);

    expect(await screen.findByText(/Where this figure came from/i)).toBeTruthy();
  });
});
