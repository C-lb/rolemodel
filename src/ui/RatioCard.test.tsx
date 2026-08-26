import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RatioCard } from "./RatioCard";
import { computeRatios, type RatioResult } from "@/model/ratios/compute";
import { fixtureWorkspace, withoutKeys } from "@/model/ratios/fixtures";
import type { AveragingMode } from "@/model/ratios/types";

function ratioResult(key: string, mode: AveragingMode = "ending", options = {}): RatioResult {
  const all = computeRatios({ workspace: fixtureWorkspace(options), mode, custom: [] });
  const found = all.find((r) => r.key === key);
  if (!found) throw new Error(`no ratio "${key}"`);
  return found;
}

const noop = () => {};

describe("a ratio that computed", () => {
  it("shows the label and the most recent value", () => {
    render(<RatioCard result={ratioResult("net_margin")} onExplain={noop} onShowProvenance={noop} />);
    expect(screen.getByText("Net margin")).toBeTruthy();
    expect(screen.getAllByText("14.0%").length).toBeGreaterThan(0);
  });

  it("shows a figure for every period", () => {
    render(<RatioCard result={ratioResult("current_ratio")} onExplain={noop} onShowProvenance={noop} />);
    expect(screen.getByText("FY2023")).toBeTruthy();
    expect(screen.getByText("FY2022")).toBeTruthy();
  });

  it("says which way is favourable", () => {
    render(<RatioCard result={ratioResult("dso")} onExplain={noop} onShowProvenance={noop} />);
    expect(screen.getByText(/lower is generally better/i)).toBeTruthy();
  });
});

describe("a ratio that could not compute", () => {
  it("names the missing line items in words, not keys", () => {
    const result = ratioResult("dio", "ending", withoutKeys(["inventory"]));
    render(<RatioCard result={result} onExplain={noop} onShowProvenance={noop} />);
    expect(screen.getAllByText(/Inventory/).length).toBeGreaterThan(0);
    // The raw canonical key must never reach the screen.
    expect(document.body.textContent).not.toContain("cost_of_revenue");
  });

  it("explains a zero denominator rather than printing a dash", () => {
    const result = ratioResult("interest_coverage", "ending", {
      overrides: [{ canonicalKey: "interest_expense", periodKey: "FY2024", value: 0 }],
    });
    render(<RatioCard result={result} onExplain={noop} onShowProvenance={noop} />);
    expect(screen.getByText(/no interest expense/i)).toBeTruthy();
  });

  it("explains negative equity rather than printing a negative return", () => {
    const result = ratioResult("roe", "ending", {
      overrides: [{ canonicalKey: "total_equity", periodKey: "FY2024", value: -7000 }],
    });
    render(<RatioCard result={result} onExplain={noop} onShowProvenance={noop} />);
    expect(screen.getByText(/negative/i)).toBeTruthy();
    expect(screen.queryByText("-30.0%")).toBeNull();
  });
});

describe("warnings", () => {
  it("shows the averaging fallback and the low-confidence note together", () => {
    const result = ratioResult("roa", "average", { confidence: 0.4 });
    render(<RatioCard result={result} onExplain={noop} onShowProvenance={noop} />);
    expect(screen.getByText(/low confidence/i)).toBeTruthy();
    expect(screen.getByText(/closing balance/i)).toBeTruthy();
  });

  it("says when a figure behind the ratio is the user's own edit", () => {
    const result = ratioResult("net_margin", "ending", {
      overrides: [{ canonicalKey: "revenue", periodKey: "FY2024", value: 16000 }],
    });
    render(<RatioCard result={result} onExplain={noop} onShowProvenance={noop} />);
    expect(screen.getByText(/your edit/i)).toBeTruthy();
  });
});

describe("the inputs breakdown", () => {
  it("stays closed until asked for", () => {
    render(<RatioCard result={ratioResult("dso", "average")} onExplain={noop} onShowProvenance={noop} />);
    expect(screen.queryByText(/Accounts receivable/)).toBeNull();
  });

  it("shows each component, the day multiplier and the averaging flag", () => {
    render(<RatioCard result={ratioResult("dso", "average")} onExplain={noop} onShowProvenance={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /show inputs/i }));
    expect(screen.getAllByText(/Accounts receivable/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/365/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/averaged/i).length).toBeGreaterThan(0);
  });

  it("shows the stored figure next to the magnitude a ratio used", () => {
    render(<RatioCard result={ratioResult("interest_coverage")} onExplain={noop} onShowProvenance={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /show inputs/i }));
    expect(screen.getByText(/\(300\)/)).toBeTruthy();
  });

  it("opens provenance for the component that was clicked", () => {
    const onShowProvenance = vi.fn();
    render(<RatioCard result={ratioResult("net_margin")} onExplain={noop} onShowProvenance={onShowProvenance} />);
    fireEvent.click(screen.getByRole("button", { name: /show inputs/i }));
    fireEvent.click(screen.getByRole("button", { name: /Revenue, FY2024/i }));
    expect(onShowProvenance).toHaveBeenCalledWith("revenue", "FY2024");
  });
});

describe("the generated reading", () => {
  it("asks for one when the button is pressed", () => {
    const onExplain = vi.fn();
    render(<RatioCard result={ratioResult("net_margin")} onExplain={onExplain} onShowProvenance={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /explain the trend/i }));
    expect(onExplain).toHaveBeenCalledWith("net_margin");
  });

  it("shows the text once it arrives", () => {
    render(
      <RatioCard
        result={ratioResult("net_margin")}
        onExplain={noop}
        onShowProvenance={noop}
        reading={{ state: "ready", text: "Margin held flat as both sides grew." }}
      />,
    );
    expect(screen.getByText(/held flat/)).toBeTruthy();
  });

  it("shows a decline as a reason rather than as empty space", () => {
    render(
      <RatioCard
        result={ratioResult("net_margin")}
        onExplain={noop}
        onShowProvenance={noop}
        reading={{ state: "declined", reason: "Only one period has a value." }}
      />,
    );
    expect(screen.getByText(/Only one period has a value/)).toBeTruthy();
  });

  it("keeps the numbers when the reading fails", () => {
    render(
      <RatioCard
        result={ratioResult("net_margin")}
        onExplain={noop}
        onShowProvenance={noop}
        reading={{ state: "failed", message: "The reading could not be generated." }}
      />,
    );
    expect(screen.getByText(/could not be generated/)).toBeTruthy();
    expect(screen.getAllByText("14.0%").length).toBeGreaterThan(0);
  });

  it("says it is working while the reading is in flight", () => {
    render(
      <RatioCard
        result={ratioResult("net_margin")}
        onExplain={noop}
        onShowProvenance={noop}
        reading={{ state: "loading" }}
      />,
    );
    expect(screen.getByRole("button", { name: /explain the trend/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/reading the numbers/i)).toBeTruthy();
  });
});

describe("a custom ratio", () => {
  it("shows the expression and the user's note instead of an authored definition", () => {
    const all = computeRatios({
      workspace: fixtureWorkspace(),
      mode: "ending",
      custom: [
        { key: "rd_intensity", label: "R&D intensity", expression: "operating_expenses / revenue", note: "My own note" },
      ],
    });
    const custom = all.find((r) => r.key === "rd_intensity");
    if (!custom) throw new Error("no custom ratio");

    render(<RatioCard result={custom} onExplain={noop} onShowProvenance={noop} onDelete={vi.fn()} />);
    expect(screen.getByText("operating_expenses / revenue")).toBeTruthy();
    expect(screen.getByText("My own note")).toBeTruthy();
  });

  it("offers a delete only for a ratio the user made", () => {
    const onDelete = vi.fn();
    render(<RatioCard result={ratioResult("net_margin")} onExplain={noop} onShowProvenance={noop} onDelete={onDelete} />);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});
