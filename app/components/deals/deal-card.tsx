import Link from "next/link";
import { Flame } from "lucide-react";

import { FreshnessChip } from "@/components/ui/freshness-chip";
import { PriceTag } from "@/components/ui/price-tag";
import { buildBookingUrl, fmtDuration } from "@/lib/flight-display";
import type {
  CabinClass,
  FlightLeg,
  Stops,
  TripType,
} from "@/src/domain/sources/types";

export type Deal = {
  searchId: string;
  optionId: string;
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
  legs: FlightLeg[];
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

// ponytail: legacy rows predate FlightLeg and carry no flight numbers, so scale
// and stops stay hidden for them. Re-scrape to backfill rather than guess.
function carriers(deal: Deal): string[] {
  const named = deal.legs.map((l) => l.airlineName || l.airline).filter(Boolean);
  return [...new Set(named.length > 0 ? named : deal.airlines.filter(Boolean))];
}

function flightNumbers(deal: Deal): string[] {
  return [...new Set(deal.legs.map((l) => l.flightNumber).filter(Boolean))];
}

function stopsLabel(deal: Deal): string | null {
  if (flightNumbers(deal).length === 0) return null;
  const n = Math.max(0, deal.legs.length - 1);
  return n === 0 ? "Directo" : `${n} escala${n > 1 ? "s" : ""}`;
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
        <div className="flex shrink-0 items-center gap-2">
          {pct != null && (
            <span className="shrink-0 rounded-full bg-savings/10 px-2.5 py-1 text-xs font-extrabold text-savings">
              −{pct}%
            </span>
          )}
          {featured && <Flame className="size-4 text-opportunity" aria-hidden />}
        </div>
      </div>

      <PriceTag
        price={deal.price}
        currency={deal.currency}
        size="lg"
        className="mt-5"
        meta={
          deal.baseline
            ? `media observada · ${deal.baseline.toFixed(0)} ${deal.currency}`
            : "mejor precio observado"
        }
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-3.5 text-sm">
        <div className="min-w-0">
          <strong className="truncate text-brand-dark">
            {carriers(deal).join(", ") || "—"}
          </strong>
          {flightNumbers(deal).length > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              {flightNumbers(deal).join(" · ")}
            </span>
          )}
        </div>
        <span className="shrink-0 text-muted-foreground">
          {[fmtDuration(deal.totalDurationMin), stopsLabel(deal)]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>

      <div className="mt-2">
        <FreshnessChip checkedAt={deal.executedAt} />
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
          <span className="flex-1 rounded-lg bg-muted p-2.5 text-sm text-muted-foreground">
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
