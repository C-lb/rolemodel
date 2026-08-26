import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ToastProvider } from "@/ui/ToastProvider";
import { WorkspaceScreen } from "./WorkspaceScreen";
import type { ForecastPanelData } from "./WorkspaceForecast";
import { computeRatios } from "@/model/ratios/compute";
import { fixtureWorkspace } from "@/model/ratios/fixtures";
import {
  selectScenarioAction,
  saveDriverAction,
  fillRightAction,
} from "@/app/actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock("@/app/actions", () => ({
  saveOverride: vi.fn(async () => ({ ok: true, data: null })),
  clearOverride: vi.fn(async () => ({ ok: true, data: null })),
  remapLineItem: vi.fn(async () => ({ ok: true, data: null })),
  setAveraging: vi.fn(async () => ({ ok: true, data: null })),
  saveRatio: vi.fn(async () => ({ ok: true, data: { key: "k" } })),
  deleteRatio: vi.fn(async () => ({ ok: true, data: null })),
  explainRatio: vi.fn(async () => ({ ok: true, data: { text: "", declined: false, reason: null, cached: false } })),
  createScenarioAction: vi.fn(async () => ({ ok: true, data: { scenarioId: "s-base" } })),
  renameScenarioAction: vi.fn(async () => ({ ok: true, data: null })),
  duplicateScenarioAction: vi.fn(async () => ({ ok: true, data: { scenarioId: "s-new" } })),
  deleteScenarioAction: vi.fn(async () => ({ ok: true, data: null })),
  selectScenarioAction: vi.fn(async () => ({ ok: true, data: null })),
  saveDriverAction: vi.fn(async () => ({ ok: true, data: null })),
  fillRightAction: vi.fn(async () => ({ ok: true, data: null })),
  setHorizonAction: vi.fn(async () => ({ ok: true, data: null })),
  runSensitivityAction: vi.fn(async () => ({
    ok: true,
    data: { rows: [0], columns: [0], cells: [[{ state: "ok", value: 1, isBase: true }]] },
  })),
}));

const selectScenario = vi.mocked(selectScenarioAction);
const saveDriver = vi.mocked(saveDriverAction);
const fillRight = vi.mocked(fillRightAction);

/** Two scenarios, each forecasting one period (FY2025) from the shared fixture history. */
function baseForecast(): ForecastPanelData {
  return {
    scenarios: [
      { id: "s-base", name: "Base", isBase: true },
      { id: "s-bull", name: "Bull", isBase: false },
    ],
    activeScenarioId: "s-base",
    horizon: 1,
    forecastPeriods: ["FY2025"],
    drivers: [
      { key: "revenue_growth", periodKey: "FY2025", value: 0.1, basis: "derived", note: "Derived from history." },
    ],
    ok: true,
    findings: [],
    cells: [
      { canonicalKey: "revenue", periodKey: "FY2025", value: 16500, formula: "revenue[FY2024] * 1.1", inputs: [{ label: "Revenue, FY2024", value: 15000 }] },
      { canonicalKey: "net_income", periodKey: "FY2025", value: 2500, formula: "pretax_income - tax", inputs: [{ label: "Pretax income", value: 3000 }] },
    ],
  };
}

function bullForecast(): ForecastPanelData {
  const base = baseForecast();
  return {
    ...base,
    activeScenarioId: "s-bull",
    cells: [
      { canonicalKey: "revenue", periodKey: "FY2025", value: 18000, formula: "revenue[FY2024] * 1.2", inputs: [{ label: "Revenue, FY2024", value: 15000 }] },
      { canonicalKey: "net_income", periodKey: "FY2025", value: 2500, formula: "pretax_income - tax", inputs: [{ label: "Pretax income", value: 3000 }] },
    ],
  };
}

function blockedForecast(): ForecastPanelData {
  return {
    scenarios: [{ id: "s-base", name: "Base", isBase: true }],
    activeScenarioId: "s-base",
    horizon: 1,
    forecastPeriods: [],
    drivers: [],
    ok: false,
    findings: [{
      code: "forecast_not_annual", severity: "blocking", periodKey: null,
      message: "The most recent period is not an annual period, so it cannot be forecast.",
      remediation: "Forecast from a workspace whose latest period is a fiscal year.",
      keys: [],
    }],
    cells: [],
  };
}

function renderScreen(forecast: ForecastPanelData) {
  const ws = fixtureWorkspace();
  return render(
    <ToastProvider>
      <WorkspaceScreen
        workspaceId="w1"
        documentName="acme-10-K.pdf"
        periods={ws.periods}
        findings={ws.findings}
        unmapped={[]}
        statements={{ income: ws.statement("income"), balance: ws.statement("balance"), cashflow: ws.statement("cashflow") }}
        ratios={computeRatios({ workspace: ws, mode: "ending", custom: [] })}
        customRatios={[]}
        averagingMode="ending"
        forecast={forecast}
      />
    </ToastProvider>,
  );
}

const openForecast = () => fireEvent.click(screen.getByRole("tab", { name: "Forecast" }));
const openRatios = () => fireEvent.click(screen.getByRole("tab", { name: "Ratios" }));

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

describe("the forecast tab", () => {
  it("is not the view the screen opens on", () => {
    renderScreen(baseForecast());
    expect(screen.queryByRole("tab", { name: "Forecast", selected: true })).toBeNull();
  });

  it("appears as a third tab and renders the forecast statements when opened", () => {
    renderScreen(baseForecast());
    openForecast();

    expect(screen.getByLabelText("Scenarios")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Base, base scenario/i })).toBeTruthy();
    // The forecast column's figure, driven by the seeded revenue_growth driver.
    expect(screen.getByRole("button", { name: /Revenue, FY2025.*16,500/ })).toBeTruthy();
  });

  it("switching scenarios changes the displayed numbers", () => {
    const { rerender } = renderScreen(baseForecast());
    openForecast();
    expect(screen.getByRole("button", { name: /Revenue, FY2025.*16,500/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Bull" }));
    expect(selectScenario).toHaveBeenCalledWith("w1", "s-bull");

    // Simulates the router refresh that follows a successful selection: the server
    // component re-renders with the newly active scenario's own forecast.
    rerender(
      <ToastProvider>
        <WorkspaceScreen
          workspaceId="w1"
          documentName="acme-10-K.pdf"
          periods={fixtureWorkspace().periods}
          findings={[]}
          unmapped={[]}
          statements={{
            income: fixtureWorkspace().statement("income"),
            balance: fixtureWorkspace().statement("balance"),
            cashflow: fixtureWorkspace().statement("cashflow"),
          }}
          ratios={computeRatios({ workspace: fixtureWorkspace(), mode: "ending", custom: [] })}
          customRatios={[]}
          averagingMode="ending"
          forecast={bullForecast()}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole("button", { name: /Revenue, FY2025.*18,000/ })).toBeTruthy();
  });

  it("a blocking finding renders its message and no numeric columns", () => {
    renderScreen(blockedForecast());
    openForecast();

    expect(screen.getByText(/cannot be forecast/)).toBeTruthy();
    expect(screen.queryByText("16,500")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("saves a driver edit and fills right through the DriverGrid", () => {
    renderScreen(baseForecast());
    openForecast();

    fireEvent.doubleClick(screen.getByText("10.00%"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(saveDriver).toHaveBeenCalledWith("w1", "s-base", "revenue_growth", "FY2025", 0.12);
  });

  it("fills a driver right from the fill-right control", () => {
    const twoPeriod: ForecastPanelData = {
      ...baseForecast(),
      forecastPeriods: ["FY2025", "FY2026"],
      drivers: [
        { key: "revenue_growth", periodKey: "FY2025", value: 0.1, basis: "derived", note: "Derived from history." },
        { key: "revenue_growth", periodKey: "FY2026", value: 0.05, basis: "default", note: "Fallback." },
      ],
      cells: [
        ...baseForecast().cells,
        { canonicalKey: "revenue", periodKey: "FY2026", value: 17325, formula: "revenue[FY2025] * 1.05", inputs: [] },
        { canonicalKey: "net_income", periodKey: "FY2026", value: 2600, formula: "pretax_income - tax", inputs: [] },
      ],
    };
    renderScreen(twoPeriod);
    openForecast();

    fireEvent.click(screen.getByRole("button", { name: "Fill revenue growth right from FY2025" }));
    expect(fillRight).toHaveBeenCalledWith("w1", "s-base", "revenue_growth", "FY2025");
  });
});

describe("ratios over the forecast", () => {
  it("gain a forecast column when a scenario is active", () => {
    renderScreen(baseForecast());
    openRatios();

    const card = cardFor("Net margin");
    expect(within(card).getByText("FY2025")).toBeTruthy();
    // 2,500 / 16,500.
    expect(within(card).getAllByText("15.2%").length).toBeGreaterThan(0);
  });

  it("says the generated reading excludes forecast periods", () => {
    renderScreen(baseForecast());
    openRatios();

    const card = cardFor("Net margin");
    expect(within(card).getByText(/Excludes forecast periods/)).toBeTruthy();
  });

  it("says nothing about forecast exclusion when no scenario is active", () => {
    renderScreen(blockedForecast());
    openRatios();

    expect(screen.queryByText(/Excludes forecast periods/)).toBeNull();
  });
});
