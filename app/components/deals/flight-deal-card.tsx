import { Flame, Plane } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PriceTag } from "@/components/ui/price-tag";
import { fmtDuration } from "@/lib/flight-display";
import type {
  FlightLeg,
  FlightOptionBookingLink,
} from "@/src/domain/sources/types";
import { splitPostData } from "@/src/domain/sources/booking-links";
import { FavoriteButton } from "./favorite-button";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Legacy rows stored the code inside flightNumber ("UX573"), the parser no longer does. */
function bareNumber(leg: FlightLeg): string {
  const code = leg.airline.trim().toUpperCase();
  return leg.flightNumber.toUpperCase().startsWith(code)
    ? leg.flightNumber.slice(code.length)
    : leg.flightNumber;
}

function flightLabel(leg: FlightLeg): string {
  const name = leg.airlineName ?? leg.airline;
  const number = bareNumber(leg);
  return number ? `${name} ${number}` : name;
}

/** Human label for the source badge (tarjeta por fuente). Unknown → hidden. */
function sourceLabel(source: string | null): string | null {
  switch (source) {
    case "google_flights":
      return "Google";
    case "serpapi":
      return "SerpAPI";
    case "ignav":
      return "Ignav";
    case "mock":
      return "Mock";
    default:
      return null;
  }
}

function LegTimeline({
  legs,
  label,
  cities,
}: {
  legs: FlightLeg[];
  label: string;
  cities: Record<string, string>;
}) {
  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <ul className="mt-1.5 flex flex-col gap-2">
        {legs.map((leg, i) => (
          <li key={`${leg.flightNumber}-${i}`} className="text-sm">
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
              <span className="whitespace-nowrap tabular-nums">
                {fmtTime(leg.departAt)} {leg.departAirport}
              </span>
              <span aria-hidden className="h-px bg-border" />
              <span className="whitespace-nowrap text-right tabular-nums">
                {leg.arriveAirport} {fmtTime(leg.arriveAt)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {leg.departAirport} {cities[leg.departAirport] ?? ""} →{" "}
              {leg.arriveAirport} {cities[leg.arriveAirport] ?? ""} ·{" "}
              {flightLabel(leg)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FlightDealCard({
  deal,
  isBestPrice,
  cities,
  isFavorite,
}: {
  deal: {
    id: string;
    price: number;
    currency: string;
    outboundLegs: FlightLeg[];
    inboundLegs: FlightLeg[];
    bookingUrl: string | null;
    source: string | null;
    bookingLinks: FlightOptionBookingLink[] | null;
  };
  isBestPrice?: boolean;
  /** IATA -> city, resolved on the server from the static dataset. */
  cities: Record<string, string>;
  isFavorite?: boolean;
}) {
  const legs = deal.outboundLegs;
  const numbers = [...new Set(legs.map(bareNumber).filter(Boolean))];
  const carriers = [
    ...new Set(legs.map((l) => l.airlineName ?? l.airline).filter(Boolean)),
  ];
  const totalLegs = legs.length + deal.inboundLegs.length;
  const stops = numbers.length === 0 ? null : Math.max(0, legs.length - 1);
  const first = legs[0];
  const last = legs.at(-1);
  // Provider links with their decoded form field (post handoffs only). A post
  // link without a valid body is dropped: the generic link stays as fallback.
  const providerLinks = (deal.bookingLinks ?? [])
    .map((link) => ({
      link,
      field:
        link.method === "post" && link.postData
          ? splitPostData(link.postData)
          : null,
    }))
    .filter(
      (entry) =>
        entry.link.method === "get" ||
        (entry.link.method === "post" && entry.field !== null),
    );

  return (
    <Card className={isBestPrice ? "ring-2 ring-opportunity/40" : undefined}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-extrabold text-brand-dark">
              {carriers.join(", ") || "—"}
            </div>
            {sourceLabel(deal.source) ? (
              <div className="mt-1">
                <Badge variant="info">vía {sourceLabel(deal.source)}</Badge>
              </div>
            ) : null}
            {numbers.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {numbers.join(" · ")}
              </div>
            )}
            {first && last ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {first.departAirport} ({cities[first.departAirport] ?? "—"}) →{" "}
                {last.arriveAirport} ({cities[last.arriveAirport] ?? "—"})
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {isBestPrice && (
              <Badge variant="warn" className="gap-1">
                <Flame className="size-3.5" aria-hidden />
                Mejor precio
              </Badge>
            )}
            <PriceTag price={deal.price} currency={deal.currency} size="md" />
            <FavoriteButton
              optionId={deal.id}
              initialFavorited={isFavorite ?? false}
            />
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {[
            fmtDuration(
              legs.reduce((s, l) => s + l.durationMin, 0) +
                deal.inboundLegs.reduce((s, l) => s + l.durationMin, 0),
            ),
            stops === null
              ? null
              : stops === 0
                ? "Directo"
                : `${stops} escala${stops > 1 ? "s" : ""}`,
          ]
            .filter(Boolean)
            .join(" · ")}
          {totalLegs === 0 && " —"}
        </p>

        <details open className="rounded-lg border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-brand-dark">
            Itinerario
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            <LegTimeline legs={legs} label="Ida" cities={cities} />
            {deal.inboundLegs.length > 0 && (
              <LegTimeline
                legs={deal.inboundLegs}
                label="Regreso"
                cities={cities}
              />
            )}
          </div>
        </details>

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
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand/40 px-3 py-2.5 text-center text-sm font-bold text-brand-dark transition-colors hover:bg-brand/10"
              >
                <Plane className="size-4" aria-hidden />
                {link.provider} · {link.price.toFixed(0)} {link.currency} →
              </button>
            </form>
          ) : (
            <a
              key={`${link.provider}-${link.price}`}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-brand/40 px-3 py-2.5 text-center text-sm font-bold text-brand-dark transition-colors hover:bg-brand/10"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Plane className="size-4" aria-hidden />
              {link.provider} · {link.price.toFixed(0)} {link.currency} →
            </a>
          ),
        )}

        {deal.bookingUrl ? (
          <a
            className="flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2.5 text-center text-sm font-bold text-white transition-colors hover:bg-brand/90"
            href={deal.bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Plane className="size-4" aria-hidden />
            Ver oferta en Google Flights →
          </a>
        ) : (
          <span className="rounded-lg bg-muted px-3 py-2.5 text-center text-sm text-muted-foreground">
            Oferta encontrada
          </span>
        )}
      </CardContent>
    </Card>
  );
}
