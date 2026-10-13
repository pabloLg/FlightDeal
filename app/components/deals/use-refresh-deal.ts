"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { refreshDealForDate } from "@/app/actions/search";

// Triggers a per-date (re)search and waits for it to settle before refreshing
// the page. The execution runs after the Server Action responds (see
// refreshDealForDate), so the only way to know it finished is polling the same
// GET the results page already uses. Shared by both offer cards.
export function useRefreshDeal(searchId: string, returnDate: string | null) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (date: string) => {
      setError(null);
      startTransition(async () => {
        try {
          const res = await refreshDealForDate(searchId, date, returnDate);
          if (!res.success) {
            setError(res.error || "No se pudo lanzar la búsqueda");
            return;
          }

          for (let attempt = 0; attempt < 20; attempt++) {
            const response = await fetch(`/api/searches/${searchId}`, {
              cache: "no-store",
            });
            if (response.ok) {
              const body = (await response.json()) as {
                execution?: { status?: string };
              };
              const status = body.execution?.status;
              if (status && status !== "pending" && status !== "running") break;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }

          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    },
    [searchId, returnDate, router],
  );

  const reset = useCallback(() => setError(null), []);

  return { run, reset, isPending, error };
}
