import type { FlightSearchParams } from "./types";

// Deterministic Google Flights TFS URL builder. The `tfs` value is URL-safe
// base64 (no padding) over a small fixed protobuf message. Field numbers
// follow the reverse-engineered spec: query_mode=1, query_context=2, legs=3,
// passengers=8, cabin=9, display_flag=14, all_results_flag=16, trip_type=19;
// FlightLeg date=2 / origin=13 / destination=14 / max_stops=5;
// Place entity_type=1 / entity_id=2.

const HOST = "https://www.google.com/travel/flights/search";

const CABIN: Record<FlightSearchParams["cabinClass"], number> = {
  economy: 1,
  premium_economy: 2,
  business: 3,
  first: 4,
};

const TRIP: Record<FlightSearchParams["tripType"], number> = {
  round_trip: 1,
  one_way: 2,
};

function varint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return bytes;
}

function int64(value: number): number[] {
  if (value >= 0) return varint(value);
  const bytes = new Array(10).fill(0xff);
  bytes[9] = 0x01;
  return bytes;
}

function tag(field: number, wire: 0 | 2): number[] {
  return varint(field * 8 + wire);
}

function varField(field: number, value: number): number[] {
  return [...tag(field, 0), ...varint(value)];
}

function lenField(field: number, payload: number[]): number[] {
  return [...tag(field, 2), ...varint(payload.length), ...payload];
}

function strField(field: number, value: string): number[] {
  return lenField(field, Array.from(new TextEncoder().encode(value)));
}

function place(iata: string): number[] {
  return lenField(13, [...varField(1, 1), ...strField(2, iata)]);
}

function leg(date: string, origin: string, destination: string, maxStops?: number): number[] {
  const body: number[] = [...strField(2, date)];
  if (maxStops !== undefined) body.push(...varField(5, maxStops));
  body.push(...place(origin));
  // destination lives in field 14, so build it directly instead of via place()
  const dest = lenField(14, [...varField(1, 1), ...strField(2, destination)]);
  body.push(...dest);
  return lenField(3, body);
}

function passengers(adults: number): number[] {
  const body: number[] = [];
  for (let i = 0; i < adults; i++) body.push(...varField(8, 1));
  return body;
}

function toBase64Url(bytes: number[]): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildTfsUrl(params: FlightSearchParams): string {
  const body: number[] = [
    ...varField(1, 28),
    ...varField(2, 2),
  ];
  const maxStops = params.stops === "non_stop" ? 0 : undefined;
  body.push(...leg(params.departDate, params.origin, params.destination, maxStops));
  if (params.tripType === "round_trip" && params.returnDate) {
    body.push(
      ...leg(params.returnDate, params.destination, params.origin, maxStops),
    );
  }
  body.push(...passengers(params.adults));
  body.push(...varField(9, CABIN[params.cabinClass]));
  body.push(...varField(14, 1));
  body.push(...lenField(16, [...tag(1, 0), ...int64(-1)]));
  body.push(...varField(19, TRIP[params.tripType]));

  const url = new URL(HOST);
  url.searchParams.set("tfs", toBase64Url(body));
  url.searchParams.set("hl", "es");
  url.searchParams.set("gl", "ES");
  url.searchParams.set("curr", params.currency || "EUR");
  return url.toString();
}