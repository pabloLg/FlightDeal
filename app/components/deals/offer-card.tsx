"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { Clock, Flame, Plane, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { FavoriteButton } from "./favorite-button";
import { UpdateBanner } from "./update-banner";
import { WeeklyCalendar } from "./weekly-calendar";
import { DateEmptyState } from "./date-empty-state";
import { useRefreshDeal } from "./use-refresh-deal";
import { fmtDuration } from "@/lib/flight-display";
import { directionSummary } from "@/src/domain/deals/flight-summary";
import { isStale, outboundDepartDate } from "@/src/domain/deals/date-window";
import { splitPostData } from "@/src/domain/sources/booking-links";
import type {
  CabinClass,
  FlightLeg,
  FlightOptionBookingLink,
  TripType,
} from "@/src/domain/sources/types";
import { cn } from "cn";

// One card layout for both lists: dashboard's featured deals and the results
// page. The two callers differ only in which fields they can fill (the
// dashboard has a baseline, the results page has per-provider links), so they
// normalise into this props shape and the mockup layout lives here once.
export type OfferCardData = {
  optionId: string;
  searchId: string;
  origin: string;
  destination: string;
  /** IATA -> city, resolved on the server from the static dataset. */
  cities: Record<string, string>;
  departDate: string | null;
  returnDate: string | null;
  tripType: TripType;
  cabinClass: CabinClass;
  adults: number;
  price: number;
  currency: string;
  baseline: number | null;
  airline: string | null;
  airlines: string[];
  outboundLegs: FlightLeg[];
  inboundLegs: FlightLeg[];
  bookingUrl: string | null;
  providerLinks?: FlightOptionBookingLink[];
  source?: string | null;
  executedAt: string | null;
  availableDates?: string[];
  executionStatus?: string | null;
  isBestPrice?: boolean;
  isFavorite?: boolean;
  featured?: boolean;
};

const TRIP_LABEL: Record<TripType, string> = {
  one_way: "Solo ida",
  round_trip: "Ida y vuelta",
};

const CABIN_LABEL: Record<CabinClass, string> = {
  economy: "Economía",
  premium_economy: "Premium economy",
  business: "Business",
  first: "Primera",
};

const SOURCE_LABEL: Record<string, string> = {
  google_flights: "Google Flights",
  serpapi: "SerpAPI",
  ignav: "Ignav",
  mock: "Mock",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function savingsPct(price: number, baseline: number | null): number | null {
  if (!baseline || baseline <= price) return null;
  return Math.round((1 - price / baseline) * 100);
}

function cityOf(cities: Record<string, string>, code: string): string {
  return cities[code.toUpperCase()] ?? code;
}

function Direction({
  label,
  legs,
  cities,
}: {
  label: string | null;
  legs: FlightLeg[];
  cities: Record<string, string>;
}) {
  const summary = directionSummary(legs);
  if (!summary) return null;
  return (
    <div>
      {label ? (
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      ) : null}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <div className="min-w-0">
          <div className="text-lg font-extrabold text-brand-dark">
            {summary.departAirport}
          </div>
          <div className="text-sm tabular-nums text-brand-dark">
            {fmtTime(summary.departAt)}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {cityOf(cities, summary.departAirport)}
          </div>
        </div>
        <div className="px-2 text-center text-[11px] text-muted-foreground">
          <div className="tabular-nums">{fmtDuration(summary.durationMin)}</div>
          <div className="my-1 h-px bg-border" />
          <div>
            {summary.stops === 0
              ? "Directo"
              : `${summary.stops} escala${summary.stops > 1 ? "s" : ""}`}
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-lg font-extrabold text-brand-dark">
            {summary.arriveAirport}
          </div>
          <div className="text-sm tabular-nums text-brand-dark">
            {fmtTime(summary.arriveAt)}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {cityOf(cities, summary.arriveAirport)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function OfferCard({ data }: { data: OfferCardData }) {
  const outDate = outboundDepartDate(data.outboundLegs);
  const [selectedDate, setSelectedDate] = useState<string | null>(
    outDate || data.departDate || data.availableDates?.[0] || null,
  );
  const [weekOffset, setWeekOffset] = useState(0);
  const { run, isPending, error: refreshError } = useRefreshDeal(
    data.searchId,
    data.returnDate,
  );
  const { show } = useToast();

  const avail = new Set(data.availableDates || []);
  const hasOfferForSelected = !!(selectedDate && outDate && outDate === selectedDate);
  const stale = hasOfferForSelected && isStale(data.executedAt);
  const isExecuting =
    data.executionStatus === "pending" ||
    data.executionStatus === "running" ||
    isPending;

  const pct = savingsPct(data.price, data.baseline);
  const airline = data.airline || data.airlines[0] || null;
  const sourceBadge = data.source ? SOURCE_LABEL[data.source] ?? data.source : null;
  const providerLinks = (data.providerLinks ?? []).map((link) => ({
    link,
    field: link.postData ? splitPostData(link.postData) : null,
  }));

  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date);
    setWeekOffset(0);
  }, []);

  const cities = data.cities;
  const heroBadges = (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      {hasOfferForSelected && pct != null ? (
        <span className="rounded-full bg-savings/10 px-2.5 py-1 text-xs font-extrabold text-savings">
          −{pct}%
        </span>
      ) : null}
      {data.featured ? (
        <Flame className="size-4 text-opportunity" aria-hidden />
      ) : null}
      {data.isBestPrice ? <Badge variant="ok">Mejor precio</Badge> : null}
      {sourceBadge ? <Badge variant="neutral">{sourceBadge}</Badge> : null}
    </div>
  );

  const hero = (
    <header className="relative isolate overflow-hidden border-b border-border bg-gradient-to-br from-white via-white to-sky px-5 py-4 sm:px-6 sm:py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <div
            className="grid size-14 shrink-0 place-items-center rounded-2xl bg-sky text-brand"
            aria-hidden
          >
            <Plane className="size-6" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-extrabold tracking-tight text-brand-dark sm:text-xl">
              {data.origin} <span className="text-brand">→</span> {data.destination}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {cityOf(cities, data.origin)} ({data.origin}) →{" "}
              {cityOf(cities, data.destination)} ({data.destination})
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                {data.adults} pasajero{data.adults > 1 ? "s" : ""}
              </span>
              <span aria-hidden>·</span>
              <span>{TRIP_LABEL[data.tripType]}</span>
              <span aria-hidden>·</span>
              <span>{CABIN_LABEL[data.cabinClass]}</span>
            </div>
          </div>
        </div>
        {heroBadges}
      </div>
    </header>
  );

  const calendarBlock = (
    <>
      <WeeklyCalendar
        selectedDate={selectedDate}
        onSelect={handleSelectDate}
        weekOffset={weekOffset}
        onWeekChange={setWeekOffset}
        availableDates={data.availableDates}
      />
      <p className="mt-2 px-1 text-[11px] text-muted-foreground">
        El calendario muestra fechas, no disponibilidad ni precios. Seleccionar
        otro día no ejecuta una búsqueda.
      </p>
    </>
  );

  if (!hasOfferForSelected && selectedDate) {
    const hasSearchedBefore = avail.size > 0;
    const execStatus = data.executionStatus;
    let message: string;
    if (execStatus === "failed") {
      message = "La última búsqueda falló. Intenta buscar de nuevo para este día.";
    } else if (execStatus === "running" || execStatus === "pending") {
      message = "Búsqueda en curso. Reutilizando estado si es posible.";
    } else if (!hasSearchedBefore) {
      message = "No hemos buscado vuelos para esta fecha con esta configuración.";
    } else {
      message = "No tenemos una oferta guardada para esta fecha.";
    }
    const title =
      !hasSearchedBefore && execStatus !== "running" && execStatus !== "pending"
        ? "Sin resultados guardados"
        : undefined;

    return (
      <article
        className={cn(
          "overflow-hidden rounded-[25px] border bg-card shadow-soft",
          data.featured ? "border-brand/50" : "border-border",
        )}
      >
        {hero}
        <div className="px-4 pb-5 pt-4 sm:px-6">
          {calendarBlock}
          <div className="mt-3">
            <DateEmptyState
              title={title}
              message={message}
              actionLabel="Buscar vuelos para este día"
              onAction={() => {
                show(`Buscando vuelos para el ${selectedDate}…`);
                run(selectedDate);
              }}
              isLoading={isExecuting}
              error={refreshError}
            />
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "overflow-hidden rounded-[25px] border bg-card shadow-soft",
        data.featured ? "border-brand/50" : "border-border",
      )}
    >
      {hero}

      <div className="@container px-4 pb-5 pt-4 sm:px-6">
        {calendarBlock}

        <section className="mt-4 grid overflow-hidden rounded-2xl border border-border @2xl:grid-cols-[1.1fr_1.4fr_1fr]">
          <div className="border-b border-border p-5 @2xl:border-b-0 @2xl:border-r">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-dark text-[11px] font-black text-white">
                {(airline ?? "—").slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-brand-dark">
                  {airline ?? "Aerolínea no indicada"}
                </div>
              </div>
            </div>
            <div className="mt-5 text-4xl font-black tracking-tight text-brand-dark sm:text-5xl">
              {data.price.toFixed(0)}{" "}
              <span className="text-2xl font-bold text-muted-foreground">
                {data.currency}
              </span>
            </div>
            {data.baseline ? (
              <div className="mt-1.5 text-xs text-muted-foreground">
                Media observada · {data.baseline.toFixed(0)} {data.currency}
              </div>
            ) : null}
            {pct != null ? (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-savings/10 px-2.5 py-1 text-xs font-extrabold text-savings">
                ↓ −{pct}% vs. media
              </div>
            ) : null}
          </div>

          <div className="flex flex-col justify-center gap-4 border-b border-border p-5 @2xl:border-b-0">
            <Direction label="Ida" legs={data.outboundLegs} cities={cities} />
            {data.inboundLegs.length > 0 ? (
              <Direction
                label="Vuelta"
                legs={data.inboundLegs}
                cities={cities}
              />
            ) : null}
          </div>

          <aside className="flex flex-col justify-center gap-5 bg-sky/40 p-5 @2xl:border-l @2xl:border-border">
            <div className="flex items-start gap-2.5 text-xs leading-snug text-muted-foreground">
              <ShieldCheck className="size-4 shrink-0 text-brand" aria-hidden />
              <div>
                <strong className="mb-1 block text-xs text-brand-dark">
                  Precio habitual
                </strong>
                {data.baseline
                  ? `${data.baseline.toFixed(0)} ${data.currency}`
                  : "Sin histórico"}
              </div>
            </div>
            <div className="flex items-start gap-2.5 text-xs leading-snug text-muted-foreground">
              <Clock className="size-4 shrink-0 text-brand" aria-hidden />
              <div>
                <strong className="mb-1 block text-xs text-brand-dark">
                  Última comprobación
                </strong>
                {data.executedAt
                  ? new Date(data.executedAt).toLocaleString("es-ES", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </div>
            </div>
          </aside>
        </section>

        {providerLinks.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {providerLinks.map(({ link, field }) =>
              link.method === "post" ? (
                <form
                  key={`${link.provider}-${link.price}`}
                  method="post"
                  action={link.url}
                  target="_blank"
                >
                  {field ? (
                    <input type="hidden" name={field.name} value={field.value} />
                  ) : null}
                  <button
                    type="submit"
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand/40 px-3 py-2.5 text-sm font-bold text-brand-dark transition-colors hover:bg-brand/10"
                  >
                    <Plane className="size-4" aria-hidden />
                    {link.provider} · {link.price.toFixed(0)} {link.currency}
                  </button>
                </form>
              ) : (
                <a
                  key={`${link.provider}-${link.price}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand/40 px-3 py-2.5 text-sm font-bold text-brand-dark transition-colors hover:bg-brand/10"
                >
                  <Plane className="size-4" aria-hidden />
                  {link.provider} · {link.price.toFixed(0)} {link.currency}
                </a>
              ),
            )}
          </div>
        ) : null}

        <UpdateBanner
          checkedAt={data.executedAt}
          isStale={stale}
          isRefreshing={isExecuting}
          onRefresh={() => {
            if (!selectedDate) return;
            show(`Actualizando ${data.origin} → ${data.destination}…`);
            run(selectedDate);
          }}
        />
        {refreshError ? (
          <p className="mt-2 text-xs text-destructive">{refreshError}</p>
        ) : null}

        <div className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-3">
          {data.bookingUrl ? (
            <a
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-3 text-sm font-extrabold text-white transition-colors hover:bg-brand/90"
              href={data.bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver oferta
            </a>
          ) : (
            <span className="flex min-h-12 items-center justify-center rounded-xl bg-muted px-3 text-center text-sm text-muted-foreground">
              Oferta encontrada
            </span>
          )}
          <Link
            className="flex min-h-12 items-center justify-center rounded-xl border border-brand/40 bg-sky px-3 text-sm font-extrabold text-brand transition-colors hover:bg-sky-2"
            href={`/searches/${data.searchId}`}
          >
            Ver vuelos
          </Link>
          <FavoriteButton
            optionId={data.optionId}
            initialFavorited={data.isFavorite ?? false}
          />
        </div>
      </div>
    </article>
  );
}
