"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useToast } from "@/components/ui/toast";
import { isStale } from "@/src/domain/deals/date-window";
import { DateEmptyState } from "./date-empty-state";
import { UpdateBanner } from "./update-banner";
import { useRefreshDeal } from "./use-refresh-deal";
import { WeeklyCalendar } from "./weekly-calendar";

// The search's single calendar. Picking a day only changes the URL (`?fecha=`,
// filters kept); a search for that day is a separate, explicit action so
// nothing is scraped just by browsing days.
export function SearchCalendar({
  searchId,
  returnDate,
  selectedDate,
  availableDates,
  executedAt,
  hasResults,
  executionFailed,
}: {
  searchId: string;
  returnDate: string | null;
  selectedDate: string | null;
  availableDates: string[];
  executedAt: string | null;
  hasResults: boolean;
  executionFailed?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [weekOffset, setWeekOffset] = useState(0);
  const { run, isPending, error } = useRefreshDeal(searchId, returnDate);
  const { show } = useToast();

  const handleSelect = useCallback(
    (date: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("fecha", date);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const search = useCallback(() => {
    if (!selectedDate) return;
    show(`Buscando vuelos para el ${selectedDate}…`);
    run(selectedDate);
  }, [run, selectedDate, show]);

  return (
    <section className="flex flex-col gap-2">
      <WeeklyCalendar
        selectedDate={selectedDate}
        onSelect={handleSelect}
        weekOffset={weekOffset}
        onWeekChange={setWeekOffset}
        availableDates={availableDates}
      />
      <p className="px-1 text-[11px] text-muted-foreground">
        El calendario muestra fechas, no disponibilidad ni precios. Seleccionar
        otro día no ejecuta una búsqueda.
      </p>
      {!hasResults ? (
        <DateEmptyState
          message={
            executionFailed
              ? "La última búsqueda falló. Intenta buscar de nuevo para este día."
              : "No tenemos una oferta guardada para esta fecha."
          }
          actionLabel="Buscar vuelos para este día"
          onAction={search}
          isLoading={isPending}
          error={error}
        />
      ) : isStale(executedAt) ? (
        <UpdateBanner
          checkedAt={executedAt}
          isStale
          isRefreshing={isPending}
          onRefresh={search}
          refreshLabel="Actualizar este día"
        />
      ) : null}
    </section>
  );
}
