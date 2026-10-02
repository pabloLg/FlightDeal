import { Flame, Plane } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { FlightLeg } from "@/src/domain/sources/types";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(min: number | null): string {
  if (!min || !Number.isFinite(min) || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
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

function LegTimeline({ legs, label }: { legs: FlightLeg[]; label: string }) {
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
              {flightLabel(leg)} · {fmtDuration(leg.durationMin)}
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
  showItinerary = false,
}: {
  deal: {
    id: string;
    price: number;
    currency: string;
    outboundLegs: FlightLeg[];
    inboundLegs: FlightLeg[];
    bookingUrl: string | null;
  };
  isBestPrice: boolean;
  showItinerary?: boolean;
}) {
  const legs = deal.outboundLegs;
  const numbers = [
    ...new Set(legs.map(bareNumber).filter((n) => n !== "")),
  ];
  const carriers = [
    ...new Set(legs.map((l) => l.airlineName || l.airline).filter(Boolean)),
  ];
  const totalLegs = legs.length + deal.inboundLegs.length;
  const stops = numbers.length === 0 ? null : Math.max(0, legs.length - 1);

  return (
    <Card className={isBestPrice ? "ring-2 ring-opportunity/40" : undefined}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-extrabold text-brand-dark">
              {carriers.join(", ") || "—"}
            </div>
            {numbers.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {numbers.join(" · ")}
              </div>
            )}
            <div className="mt-1 text-xs text-muted-foreground">
              {legs.length > 0 &&
                `${legs[0].departAirport} → ${legs.at(-1)?.arriveAirport}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isBestPrice && (
              <span className="inline-flex items-center gap-1 rounded-full bg-opportunity/10 px-2 py-0.5 text-xs font-bold text-opportunity">
                <Flame className="size-3.5" aria-hidden />
                Mejor precio
              </span>
            )}
            <span className="text-2xl font-extrabold tabular-nums text-ink">
              {deal.price.toFixed(0)}{" "}
              <span className="text-base">{deal.currency}</span>
            </span>
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

        {showItinerary ? (
          <div className="flex flex-col gap-3">
            <LegTimeline legs={legs} label="Ida" />
            {deal.inboundLegs.length > 0 && (
              <LegTimeline legs={deal.inboundLegs} label="Regreso" />
            )}
          </div>
        ) : (
          <details className="rounded-lg border border-border px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-brand-dark">
              Mostrar itinerario
            </summary>
            <div className="mt-2 flex flex-col gap-3">
              <LegTimeline legs={legs} label="Ida" />
              {deal.inboundLegs.length > 0 && (
                <LegTimeline legs={deal.inboundLegs} label="Regreso" />
              )}
            </div>
          </details>
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