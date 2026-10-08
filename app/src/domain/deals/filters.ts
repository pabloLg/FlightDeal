import type { FlightOptionBookingLink } from "@/src/domain/sources/types";

export type FlightOptionRow = {
  id: string;
  price_eur: number;
  currency: string;
  outbound_legs: FlightLegLike[];
  inbound_legs: FlightLegLike[];
  airlines: string[];
  total_duration_min: number | null;
  /** Which source observed this row (tarjeta por fuente). Null on old rows. */
  source_id: string | null;
  /** Per-provider purchase links (fase booking). Null when none fetched. */
  booking_links: FlightOptionBookingLink[] | null;
};

export type FlightLegLike = {
  airline: string;
  airlineName?: string;
  flightNumber: string;
  departAirport: string;
  arriveAirport: string;
  departAt: string;
  arriveAt: string;
  durationMin: number;
};

export type Filters = {
  maxPrice: number | null;
  maxDuration: number | null;
  nonStopOnly: boolean;
  airline: string | null;
  sort: "price" | "duration" | "stops";
};

export const DEFAULT_FILTERS: Filters = {
  maxPrice: null,
  maxDuration: null,
  nonStopOnly: false,
  airline: null,
  sort: "price",
};

/** URL params are user input: anything unparseable falls back to the default. */
export function parseFilters(
  sp: Record<string, string | string[] | undefined>,
): Filters {
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const num = (k: string) => {
    const raw = one(k);
    if (raw == null || raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const airline = one("aerolinea")?.trim();
  const sort = one("ord");
  return {
    maxPrice: num("precio"),
    maxDuration: num("dur"),
    nonStopOnly: one("directo") === "1",
    airline: airline ? airline : null,
    sort: sort === "duration" || sort === "stops" ? sort : "price",
  };
}

export function stopsOf(row: FlightOptionRow): number {
  return Math.max(0, row.outbound_legs.length - 1);
}

export function airlineOptions(rows: FlightOptionRow[]): string[] {
  const byCode = new Map<string, string>();
  for (const r of rows) {
    for (const l of r.outbound_legs) byCode.set(l.airline, l.airlineName ?? l.airline);
    for (const a of r.airlines) if (!byCode.has(a)) byCode.set(a, a);
  }
  return [...byCode.values()].sort();
}

export function applyFilters(
  rows: FlightOptionRow[],
  f: Filters,
): FlightOptionRow[] {
  const kept = rows.filter(
    (r) =>
      (f.maxPrice == null || Number(r.price_eur) <= f.maxPrice) &&
      (f.maxDuration == null ||
        (r.total_duration_min != null && r.total_duration_min <= f.maxDuration)) &&
      (!f.nonStopOnly || stopsOf(r) === 0) &&
      (f.airline == null ||
        r.airlines.includes(f.airline) ||
        r.outbound_legs.some((l) => (l.airlineName ?? l.airline) === f.airline)),
  );
  const by = {
    price: (a: FlightOptionRow, b: FlightOptionRow) => a.price_eur - b.price_eur,
    duration: (a: FlightOptionRow, b: FlightOptionRow) =>
      (a.total_duration_min ?? Infinity) - (b.total_duration_min ?? Infinity),
    stops: (a: FlightOptionRow, b: FlightOptionRow) =>
      stopsOf(a) - stopsOf(b) || a.price_eur - b.price_eur,
  }[f.sort];
  return [...kept].sort(by);
}