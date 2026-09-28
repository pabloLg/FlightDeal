import { optionKey } from "./option-key";
import type { FlightSearchParams, FlightOption, FlightLeg } from "./types";

// Parser for the Google Flights AF_initDataCallback({key: 'ds:1', ...}) payload.
// That script carries the search results: the [2][0] entry is the featured
// "best options" block and [3][0] the full list of outbound options. Each option
// is [detail, [priceInfo, token], ...]:
//   detail[0]       airline code            detail[0][1] airline name
//   detail[2]       flight legs (one per segment)
//     leg[3]        departure airport code  leg[6] arrival airport code
//     leg[8]        [depH, depM]            leg[10] [arrH, arrM]
//     leg[11]       duration minutes        leg[20] [y,m,d] dep date
//     leg[21]       [y,m,d] arr date        leg[22] [airline, flightNumber, , name]
//   option[1]       [ [null, price], bookingToken ]
//
// Note: Google's "featured outbound" view lists one-way legs with the total
// round-trip price already folded in; the return legs are only offered after
// selecting an outbound flight, so inboundLegs stay empty at parse time.

export interface RawFlightLeg {
  airline: string;
  flightNumber: string;
  departAirport: string;
  arriveAirport: string;
  departAt: string;
  arriveAt: string;
  durationMin: number;
}

export interface RawFlightOption {
  airline: string;
  price: number;
  outboundLegs: RawFlightLeg[];
  totalDurationMin: number;
}

const DS1_START = "AF_initDataCallback({key: 'ds:1'";
const DS1_END = "sideChannel: {}});";

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function formatDate(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const [y, m, d] = raw as number[];
  if (typeof y !== "number" || typeof m !== "number" || typeof d !== "number") {
    return null;
  }
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

function formatTime(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length < 1) return null;
  const h = raw[0];
  const m = raw[1] ?? 0;
  if (typeof h !== "number" || typeof m !== "number") return null;
  return `${pad(h)}:${pad(m)}:00`;
}

// Shared by both carriers of the same payload shape: the page's ds:1 script and
// the GetShoppingResults RPC body (see rpc-return-legs.ts).
export function parseOptionsPayload(data: unknown): RawFlightOption[] {
  if (!Array.isArray(data)) return [];
  // data[2] is the "best options" block Google shows first (its first entry is
  // the flight that a click-through would select) and data[3] the rest of the
  // list. Read both best-first and drop the flights they repeat, otherwise the
  // cheapest ones never reach the tracker.
  const seen = new Set<string>();
  const options: RawFlightOption[] = [];
  for (const section of [data[2], data[3]]) {
    const list = Array.isArray(section) ? section[0] : null;
    if (!Array.isArray(list)) continue;
    for (const option of list as unknown[][]) {
      const parsed = parseOption(option);
      if (parsed === null) continue;
      const key = optionKey("gf", parsed.outboundLegs, []);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(parsed);
    }
  }
  return options;
}

export function parseLeg(leg: unknown): RawFlightLeg | null {
  if (!Array.isArray(leg)) return null;
  const departAirport = leg[3];
  const arriveAirport = leg[6];
  const durationMin = leg[11];
  const departAt = combineDateTime(leg[20], leg[8]);
  const arriveAt = combineDateTime(leg[21], leg[10]);
  const flightInfo = Array.isArray(leg[22]) ? (leg[22] as unknown[]) : null;
  if (
    typeof departAirport !== "string" ||
    typeof arriveAirport !== "string" ||
    typeof durationMin !== "number" ||
    departAt === null ||
    arriveAt === null
  ) {
    return null;
  }
  return {
    airline: typeof flightInfo?.[0] === "string" ? (flightInfo[0] as string) : "",
    flightNumber:
      typeof flightInfo?.[1] === "string" ? (flightInfo[1] as string) : "",
    departAirport,
    arriveAirport,
    departAt,
    arriveAt,
    durationMin,
  };
}

function combineDateTime(date: unknown, time: unknown): string | null {
  const d = formatDate(date);
  const t = formatTime(time);
  if (d === null || t === null) return null;
  return `${d}T${t}`;
}

function parseOption(option: unknown): RawFlightOption | null {
  if (!Array.isArray(option)) return null;
  const detail = option[0];
  if (!Array.isArray(detail)) return null;
  const legs = Array.isArray(detail[2]) ? (detail[2] as unknown[]) : [];
  const outboundLegs = legs
    .map(parseLeg)
    .filter((leg): leg is RawFlightLeg => leg !== null);
  if (outboundLegs.length === 0) return null;
  const priceInfo = Array.isArray(option[1]) ? (option[1] as unknown[]) : [];
  const price = Array.isArray(priceInfo[0]) ? (priceInfo[0] as unknown[])[1] : null;
  if (typeof detail[0] !== "string" || typeof price !== "number") return null;
  return {
    airline: detail[0] as string,
    price,
    outboundLegs,
    totalDurationMin: outboundLegs.reduce((sum, l) => sum + l.durationMin, 0),
  };
}

// Returns the parsed ds:1 payload (its `data` value) or null when the capture
// has no ds:1 callback or its body does not parse as JSON.
export function extractDs1Json(html: string): unknown {
  const start = html.indexOf(DS1_START);
  if (start < 0) return null;
  const dataAt = html.indexOf("data:", start);
  if (dataAt < 0) return null;
  const end = html.indexOf(DS1_END, dataAt);
  if (end < 0) return null;
  const close = html.lastIndexOf("]", end);
  if (close <= dataAt) return null;
  const body = html.slice(dataAt + "data:".length, close + 1);

  // Tolerate the JSON-string-escaped layer some captures carry (\" escapes)
  // while keeping the raw HTML path as the main one.
  try {
    return JSON.parse(body);
  } catch {
    try {
      return JSON.parse(JSON.parse(`"${body}"`) as string);
    } catch {
      return null;
    }
  }
}

export function parsePage(html: string): RawFlightOption[] {
  const data = extractDs1Json(html);
  if (data === null) return [];
  return parseOptionsPayload(data);
}

export function normalize(
  raw: RawFlightOption[],
  params: FlightSearchParams,
): FlightOption[] {
  return raw.map((option) => {
    const outboundLegs: FlightLeg[] = option.outboundLegs.map((leg) => ({ ...leg }));
    return {
      id: optionKey("gf", outboundLegs, []),
      price: option.price,
      currency: params.currency,
      outboundLegs,
      inboundLegs: [],
      airlines: [option.airline],
      totalDurationMin: option.totalDurationMin,
    };
  });
}