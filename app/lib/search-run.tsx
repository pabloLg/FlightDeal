"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { SearchLoadingOverlay } from "@/components/search/search-loading-overlay";

type SearchRun = {
  /** Lanza una ejecución y espera a que acabe (o falle). */
  run: (searchId: string, label?: string) => Promise<void>;
  /** Búsqueda que está corriendo ahora, si hay alguna. */
  runningId: string | null;
  /** Último error al lanzar, si lo hubo. */
  error: string | null;
};

// Sin provider (tests, componentes aislados) la ejecución no hace nada.
const NOOP_SEARCH_RUN: SearchRun = { run: async () => {}, runningId: null, error: null };

const SearchRunContext = createContext<SearchRun | null>(null);

export function SearchRunProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Una ejecución a la vez: lanzar dos scrapes en paralelo solo gasta cuota.
  const inFlight = useRef(false);

  const run = useCallback<SearchRun["run"]>(
    async (searchId, runLabel) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setRunningId(searchId);
      setLabel(runLabel ?? null);
      setError(null);
      try {
        const res = await fetch(`/api/searches/${searchId}`, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error ?? "No se pudo iniciar la búsqueda");
          return;
        }
        const { executionId } = await res.json();

        for (let i = 0; i < 60; i++) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          const status = await fetch(`/api/searches/${searchId}`);
          if (!status.ok) continue;
          const { execution } = await status.json();
          if (execution.id !== executionId) break;
          if (["completed", "degraded", "failed"].includes(execution.status)) break;
        }
      } finally {
        inFlight.current = false;
        setRunningId(null);
        setLabel(null);
        router.refresh();
      }
    },
    [router],
  );

  return (
    <SearchRunContext.Provider value={{ run, runningId, error }}>
      {children}
      {runningId !== null && <SearchLoadingOverlay label={label} />}
    </SearchRunContext.Provider>
  );
}

export function useSearchRun(): SearchRun {
  return useContext(SearchRunContext) ?? NOOP_SEARCH_RUN;
}
