import Link from "next/link";
import { Flame } from "lucide-react";

import { buildBookingUrl, fmtDuration } from "@/lib/flight-display";
import type { CabinClass, Stops, TripType } from "@/src/domain/sources/types";

export type Deal = {
  searchId: string;
  origin: string;
  destination: string;
  departDate: string | null;
  returnDate: string | null;
  tripType: TripType;
  cabinClass: CabinClass;
  stops: Stops;
  adults: number;
  price: number;
  currency: string;
  airlines: string[];
  totalDurationMin: number | null;
  baseline: number | null;
  executedAt: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  });
}

function savingsPct(deal: Deal): number | null {
  if (!deal.baseline || deal.baseline <= deal.price) return null;
  return Math.round((1 - deal.price / deal.baseline) * 100);
}

export function DealCard({ deal, featured }: { deal: Deal; featured?: boolean }) {
  const pct = savingsPct(deal);
  const dates =
    [fmtDate(deal.departDate), fmtDate(deal.returnDate)].filter(Boolean).join(" → ") ||
    "Fechas flexibles";
  const bookingUrl = buildBookingUrl({
    origin: deal.origin,
    destination: deal.destination,
    depart_date: deal.departDate,
    return_date: deal.returnDate,
    trip_type: deal.tripType,
    cabin_class: deal.cabinClass,
    stops: deal.stops,
    adults: deal.adults,
  });

  return (
    <article
      className={`relative flex flex-col overflow-hidden rounded-2xl border bg-card p-5 shadow-soft ${
        featured ? "border-brand/50" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-extrabold tracking-tight text-brand-dark">
            {deal.origin} → {deal.destination}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {dates} · {deal.tripType === "one_way" ? "solo ida" : "ida y vuelta"} ·{" "}
            {deal.adults} pax
          </div>
        </div>
        {pct != null && (
          <span className="shrink-0 rounded-full bg-savings/10 px-2.5 py-1 text-xs font-extrabold text-savings">
            −{pct}%
          </span>
        )}
        {featured && (
          <Flame className="size-4 text-opportunity absolute -top-1.5 -right-1.5" />
        )}
      </div>

      <div className="mt-5 text-4xl font-extrabold tracking-tight text-ink">
        {deal.price.toFixed(0)}{" "}
        <span className="text-2xl">{deal.currency}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {deal.baseline
          ? `media observada · ${deal.baseline.toFixed(0)} ${deal.currency}`
          : "mejor precio observado"}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3.5 text-sm">
        <strong className="truncate text-brand-dark">
          {deal.airlines.join(", ") || "—"}
        </strong>
        <span className="shrink-0 text-muted-foreground">
          {fmtDuration(deal.totalDurationMin)}
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        {bookingUrl ? (
          <a
            className="flex-1 rounded-lg bg-brand px-3 py-2.5 text-center text-sm font-bold text-white transition-colors hover:bg-brand/90"
            href={bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver oferta →
          </a>
        ) : (
          <span className="flex-1 text-sm text-muted-foreground rounded-lg bg-muted p-2.5">
            Oferta encontrada
          </span>
        )}
        <Link
          className="flex-1 rounded-lg border border-border px-3 py-2.5 text-center text-sm font-bold text-brand-dark transition-colors hover:bg-muted"
          href={`/searches/${deal.searchId}`}
        >
          Ver vuelos
        </Link>
      </div>
    </article>
  );
}
