"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Minimal toast: a single transient message for UI feedback (favorito,
// refresco, selección de fecha). No queue, no portals, no dependency — one
// message at a time is all the app needs.
type ToastContextValue = { show: (message: string) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? { show: () => {} };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
      >
        {message ? (
          <div className="pointer-events-auto max-w-md rounded-xl bg-brand-dark px-4 py-2.5 text-sm font-medium text-white shadow-card">
            {message}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
