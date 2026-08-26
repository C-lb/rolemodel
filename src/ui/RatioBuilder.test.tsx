import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RatioBuilder } from "./RatioBuilder";
import { computeRatios } from "@/model/ratios/compute";
import { fixtureWorkspace } from "@/model/ratios/fixtures";
import type { RatioPeriodResult } from "@/model/ratios/compute";

/** A preview that computes for real, so the test exercises the same path the screen does. */
function preview(expression: string): RatioPeriodResult[] {
  const all = computeRatios({
    workspace: fixtureWorkspace(),
    mode: "ending",
    custom: [{ key: "preview", label: "Preview", expression, note: null }],
  });
  return all.find((r) => r.key === "preview")?.periods ?? [];
}

function setup(overrides: Partial<Parameters<typeof RatioBuilder>[0]> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <RatioBuilder
      onPreview={preview}
      onSave={onSave}
      onCancel={onCancel}
      saveError={null}
      {...overrides}
    />,
  );
  return { onSave, onCancel };
}

// Exact, because every chip is labelled "Add <item> to the expression".
const expressionField = () => screen.getByLabelText("Expression") as HTMLTextAreaElement;

describe("building an expression", () => {
  it("appends a line item when its add button is pressed", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /add Revenue to the expression/i }));
    expect(expressionField().value).toBe("revenue");
  });

  it("joins the second addition with an operator rather than running the words together", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /add Revenue to the expression/i }));
    fireEvent.click(screen.getByRole("button", { name: /^divide$/i }));
    fireEvent.click(screen.getByRole("button", { name: /add Total assets to the expression/i }));
    expect(expressionField().value).toBe("revenue / total_assets");
  });

  it("lets the expression be typed directly", () => {
    setup();
    fireEvent.change(expressionField(), { target: { value: "gross_profit / revenue" } });
    expect(expressionField().value).toBe("gross_profit / revenue");
  });

  it("keeps hand edits when a chip is added afterwards", () => {
    setup();
    fireEvent.change(expressionField(), { target: { value: "gross_profit /" } });
    fireEvent.click(screen.getByRole("button", { name: /add Revenue to the expression/i }));
    expect(expressionField().value).toBe("gross_profit / revenue");
  });
});

describe("validation", () => {
  it("reports where a malformed expression went wrong", () => {
    setup();
    fireEvent.change(expressionField(), { target: { value: "revenue / " } });
    // The operand is missing one past the end of a ten-character expression.
    expect(screen.getByText(/character 11/i)).toBeTruthy();
  });

  it("will not save while the expression is malformed", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Broken" } });
    fireEvent.change(expressionField(), { target: { value: "revenue /" } });
    expect((screen.getByRole("button", { name: /^save ratio$/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^save ratio$/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("will not save without a name", () => {
    setup();
    fireEvent.change(expressionField(), { target: { value: "revenue / total_assets" } });
    expect((screen.getByRole("button", { name: /^save ratio$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a failure the server reported", () => {
    setup({ saveError: "This makes Alpha depend on Beta, which refers back to itself." });
    expect(screen.getByText(/refers back to itself/)).toBeTruthy();
  });
});

describe("the live preview", () => {
  it("shows a value per period before anything is saved", () => {
    setup();
    fireEvent.change(expressionField(), { target: { value: "gross_profit / revenue" } });
    expect(screen.getByText("FY2024")).toBeTruthy();
    // One per period, and the fixture holds a 40% gross margin in all three.
    expect(screen.getAllByText("0.40x")).toHaveLength(3);
  });

  it("says which figures are missing rather than showing a blank", () => {
    setup();
    fireEvent.change(expressionField(), { target: { value: "revenue / treasury_stock" } });
    expect(screen.getAllByText(/—/).length).toBeGreaterThan(0);
    // Named in the preview warning as well as in the chip palette.
    expect(screen.getAllByText(/Treasury stock/).length).toBeGreaterThan(1);
  });
});

describe("saving", () => {
  it("hands back the name, the expression and the note", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "R&D intensity" } });
    fireEvent.change(expressionField(), { target: { value: "research_development / revenue" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Product reinvestment" } });
    fireEvent.click(screen.getByRole("button", { name: /^save ratio$/i }));

    expect(onSave).toHaveBeenCalledWith({
      label: "R&D intensity",
      expression: "research_development / revenue",
      note: "Product reinvestment",
    });
  });

  it("sends a null note rather than an empty string", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alpha" } });
    fireEvent.change(expressionField(), { target: { value: "revenue / total_assets" } });
    fireEvent.click(screen.getByRole("button", { name: /^save ratio$/i }));
    expect(onSave.mock.calls[0][0].note).toBeNull();
  });

  it("cancels without saving", () => {
    const { onSave, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("opens with an existing ratio when one is being edited", () => {
    setup({ initial: { label: "Alpha", expression: "revenue / total_assets", note: "note" } });
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Alpha");
    expect(expressionField().value).toBe("revenue / total_assets");
  });
});
