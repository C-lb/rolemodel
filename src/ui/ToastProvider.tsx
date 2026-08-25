"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  undo?: () => void;
}

interface ToastApi {
  show(message: string, opts?: { undo?: () => void }): void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useToast must be used inside ToastProvider");
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastApi["show"]>(
    (message, opts) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, message, undo: opts?.undo }]);
      setTimeout(() => dismiss(id), opts?.undo ? 8000 : 4000);
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/10 bg-neutral-900 px-3.5 py-2.5 text-sm text-neutral-100 shadow-[0_14px_34px_-18px_rgba(0,0,0,0.65)]"
          >
            <span className="whitespace-nowrap">{t.message}</span>
            {t.undo && (
              <button
                type="button"
                className="whitespace-nowrap rounded-[10px] px-1.5 py-0.5 text-xs font-medium text-neutral-100 underline decoration-neutral-500 underline-offset-2 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-300"
                onClick={() => {
                  t.undo?.();
                  dismiss(t.id);
                }}
              >
                Undo
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
