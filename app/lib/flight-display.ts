import { buildTfsUrl } from "@/src/domain/sources/tfs-url";
import type { CabinClass, Stops, TripType } from "@/src/domain/sources/types";

export function fmtDuration(min: number | null | undefined): string {
  if (!min || !Number.isFinite(min) || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export type BookingSearch = {
  origin: string;
  destination: string;
  depart_date: string | null;
  return_date: string | null;
  trip_type: TripType;
  cabin_class: CabinClass;
  stops: Stops;
  adults: number;
};

// Real, deterministic fallback while flight_options has no stored deeplink:
// a Google Flights search built from the saved search params. Returns null when
// there is no departure date to build a valid URL.
export function buildBookingUrl(search: BookingSearch): string | null {
  if (!search.depart_date) return null;
  return buildTfsUrl({
    origin: search.origin,
    destination: search.destination,
    departDate: search.depart_date,
    returnDate: search.return_date ?? undefined,
    tripType: search.trip_type,
    cabinClass: search.cabin_class,
    stops: search.stops,
    adults: search.adults,
    currency: "EUR",
  });
}
