import { buildTfsUrl } from "@/src/domain/sources/tfs-url";
import type { CabinClass, Stops, TripType } from "@/src/domain/sources/types";

export function fmtDuration(min: number | null | undefined): string {
  if (!min || !Number.isFinite(min) || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

// "hace 2 h" / "hace 3 días", or null when there is no timestamp. Relative on
// purpose: an absolute date says nothing about how stale a price is.
export function fmtFreshness(iso: string | null): string | null {
  if (!iso) return null;
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min)) return null;
  if (Math.abs(min) < 60) return rtf.format(-min, "minute");
  const hours = Math.round(min / 60);
  if (Math.abs(hours) < 48) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
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
