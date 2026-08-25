"use client";

import { useRef, useState, type DragEvent } from "react";
import { Tooltip } from "./Tooltip";
import { tooltip } from "./tooltips";

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
}

export function DropZone({ onFile, busy }: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    if (busy) return;
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setOver(true);
      }}
      onDragLeave={(e) => {
        const related = e.relatedTarget as Node | null;
        if (!related || !e.currentTarget.contains(related)) setOver(false);
      }}
      onDrop={handleDrop}
      className={[
        "flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-8 py-14 text-center transition-colors",
        over ? "border-sky-500/70 bg-sky-500/[0.06]" : "border-white/10",
        busy ? "opacity-60" : "",
      ].join(" ")}
    >
      <Tooltip label={tooltip("control.upload")}>
        <p className="max-w-[38ch] text-sm leading-relaxed text-neutral-400">
          Drop a 10-K, 10-Q, case PDF or Excel workbook here
        </p>
      </Tooltip>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={[
          "inline-flex items-center gap-2 whitespace-nowrap rounded-[10px] border border-white/10 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-100",
          "transition-colors hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400",
          "disabled:cursor-not-allowed disabled:opacity-50",
        ].join(" ")}
      >
        {busy && (
          <span
            aria-hidden="true"
            className="size-[1em] animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {busy ? "Extracting…" : "Choose a file"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.xlsx,.xls,.xlsm"
        disabled={busy}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
