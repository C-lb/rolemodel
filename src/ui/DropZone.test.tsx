import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { DropZone } from "./DropZone";

// jsdom has no real DragEvent implementation, so testing-library's built-in
// fireEvent.dragOver/dragLeave silently fall back to a plain Event and lose
// relatedTarget. A native MouseEvent carries relatedTarget correctly and
// React's synthetic event forwards it, so we dispatch that instead.
function drag(type: "dragover" | "dragleave", el: Element, relatedTarget: EventTarget | null) {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget }));
}

function dropZoneEl(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error("DropZone root not found");
  return el;
}

describe("DropZone drag highlight", () => {
  it("stays highlighted when the drag moves across a child element", () => {
    const { container } = render(<DropZone onFile={vi.fn()} busy={false} />);
    const zone = dropZoneEl(container);
    const child = zone.querySelector("button");
    if (!child) throw new Error("expected a child element inside the drop zone");

    drag("dragover", zone, null);
    expect(zone.className).toContain("border-sky-500");

    // A bubbled dragleave whose relatedTarget is still inside the zone (e.g. the
    // pointer moved onto a child) must not clear the highlight.
    drag("dragleave", zone, child);
    expect(zone.className).toContain("border-sky-500");
  });

  it("clears the highlight when the drag actually leaves the zone", () => {
    const { container } = render(<DropZone onFile={vi.fn()} busy={false} />);
    const zone = dropZoneEl(container);

    drag("dragover", zone, null);
    expect(zone.className).toContain("border-sky-500");

    drag("dragleave", zone, document.body);
    expect(zone.className).not.toContain("border-sky-500");
  });

  it("clears the highlight when the drag leaves the window entirely (relatedTarget null)", () => {
    const { container } = render(<DropZone onFile={vi.fn()} busy={false} />);
    const zone = dropZoneEl(container);

    drag("dragover", zone, null);
    expect(zone.className).toContain("border-sky-500");

    drag("dragleave", zone, null);
    expect(zone.className).not.toContain("border-sky-500");
  });
});
