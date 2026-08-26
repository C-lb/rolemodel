import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline, sparklineSegments } from "./Sparkline";

describe("sparklineSegments", () => {
  it("draws one run through a complete series", () => {
    expect(sparklineSegments([1, 2, 3])).toHaveLength(1);
  });

  it("breaks the line where a period has no value", () => {
    // Joining across a gap draws a trend through a number that was never computed.
    const segments = sparklineSegments([1, 2, null, 4, 5]);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(2);
    expect(segments[1]).toHaveLength(2);
  });

  it("drops a lone point rather than drawing a line to nowhere", () => {
    expect(sparklineSegments([1, null, 3, null])).toEqual([]);
  });

  it("places a flat series on the mid-line rather than dividing by zero", () => {
    const [segment] = sparklineSegments([5, 5, 5]);
    const ys = segment.map((point) => point.y);
    expect(new Set(ys).size).toBe(1);
    expect(Number.isFinite(ys[0])).toBe(true);
  });

  it("puts the highest value nearer the top of the box", () => {
    const [segment] = sparklineSegments([1, 9]);
    expect(segment[1].y).toBeLessThan(segment[0].y);
  });
});

describe("Sparkline", () => {
  it("hides itself from screen readers, because the numbers are already in the table", () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} label="Net margin trend" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nothing at all when there is no line to draw", () => {
    const { container } = render(<Sparkline values={[null, null]} label="empty" />);
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("renders one polyline per unbroken run", () => {
    const { container } = render(<Sparkline values={[1, 2, null, 4, 5]} label="broken" />);
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
  });
});
