import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProvenancePanel } from "./ProvenancePanel";
import type { Cell } from "@/model/workspace";
import type { Provenance } from "@/db/schema";

const provenance: Provenance = {
  page: 42, sheet: null, locator: 'page 42, line "Total revenue"',
  rawLabel: "Total revenue", rawValue: "8,400", scaleFactor: 1000,
  scaleEvidence: "In thousands", signFlipped: false,
};

function cell(over: Partial<Cell> = {}): Cell {
  return {
    canonicalKey: "revenue", periodKey: "FY2024", value: 8_400_000, source: "extracted",
    extractedValue: 8_400_000, confidence: 0.9, provenance, ...over,
  };
}

function renderPanel(over: Partial<Cell> = {}) {
  const onClose = vi.fn();
  const onReset = vi.fn();
  render(
    <ProvenancePanel cell={cell(over)} documentName="acme-10-K.pdf" onClose={onClose} onReset={onReset} />,
  );
  return { onClose, onReset };
}

describe("ProvenancePanel", () => {
  it("names the document, page and label as printed", () => {
    renderPanel();
    expect(screen.getByText("acme-10-K.pdf")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("Total revenue")).toBeTruthy();
    expect(screen.getByText("× 1,000")).toBeTruthy();
  });

  it("says there is nothing to trace for a value the user typed", () => {
    renderPanel({ source: "override", provenance: undefined, extractedValue: undefined, confidence: undefined });
    expect(screen.getByText(/You entered this value/)).toBeTruthy();
  });

  it("shows the override beside the extracted value with a reset control", () => {
    const { onReset } = renderPanel({ source: "override", value: 9_000_000 });

    expect(screen.getByText("Extracted value").nextSibling?.textContent).toContain("8,400,000");
    expect(screen.getByText("Your value").nextSibling?.textContent).toContain("9,000,000");

    fireEvent.click(screen.getByRole("button", { name: "Reset to extracted value" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("offers no reset for a figure the user has not overridden", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: "Reset to extracted value" })).toBeNull();
  });

  it("closes on Escape", () => {
    const { onClose } = renderPanel();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes focus on open and gives it back to the opener on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <ProvenancePanel cell={cell()} documentName="acme-10-K.pdf" onClose={() => {}} onReset={() => {}} />,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Close"));

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
