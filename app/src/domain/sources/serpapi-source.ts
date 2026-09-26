import type { FlightSource } from "./flight-source";
import { httpJsonFetcher, parseJson, type JsonFetcher } from "./http-json";
import { optionKey } from "./option-key";
import type {
  FlightSearchParams,
  FlightOption,
  FlightLeg,
  FlightSourceResult,
  HealthStatus,
} from "./types";

export const SERPAPI_STRUCTURE_VERSION = 1;

// SerpAPI `google_flights` engine. Two parameter encodings are easy to invert and
// silently return the wrong thing, so they are pinned here:
//   type:  1 = round trip (default), 2 = one way, 3 = multi-city
//   stops: 0 = any, 1 = nonstop only, 2 = at most 1 stop, 3 = at most 2 stops
const TRAVEL_CLASS: Record<FlightSearchParams["cabinClass"], number> = {
  economy: 1,
  premium_economy: 2,
  business: 3,
  first: 4,
};

interface SerpFlight {
  departure_airport?: { id?: string; time?: string };
  arrival_airport?: { id?: string; time?: string };
  duration?: number;
  airline?: string;
  flight_number?: string;
}

interface SerpResult {
  flights?: SerpFlight[];
  price?: number;
  total_duration?: number;
}

interface SerpResponse {
  error?: string;
  search_metadata?: { status?: string };
  search_parameters?: { currency?: string };
  best_flights?: SerpResult[];
  other_flights?: SerpResult[];
}

function toIsoLocal(raw: string | undefined): string | null {
  if (!raw) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!match) return null;
  return `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? "00"}`;
}

function toLeg(raw: SerpFlight): FlightLeg | null {
  const departAirport = raw.departure_airport?.id;
  const arriveAirport = raw.arrival_airport?.id;
  const departAt = toIsoLocal(raw.departure_airport?.time);
  const arriveAt = toIsoLocal(raw.arrival_airport?.time);
  if (!departAirport || !arriveAirport || !departAt || !arriveAt) return null;

  return {
    airline: raw.airline ?? "",
    flightNumber: raw.flight_number ?? "",
    departAirport,
    arriveAirport,
    departAt,
    arriveAt,
    durationMin: raw.duration ?? 0,
  };
}

function toOption(raw: SerpResult, currency: string): FlightOption | null {
  if (typeof raw.price !== "number" || !Array.isArray(raw.flights)) return null;
  const outboundLegs = raw.flights.map(toLeg);
  if (outboundLegs.some((leg) => leg === null)) return null;
  const legs = outboundLegs as FlightLeg[];
  if (legs.length === 0) return null;

  return {
    // Return legs need a second request with the result's departure_token, so
    // inboundLegs stay empty; the price is still the full round-trip total.
    id: optionKey("sa", legs, []),
    price: raw.price,
    currency,
    outboundLegs: legs,
    inboundLegs: [],
    airlines: [...new Set(legs.map((leg) => leg.airline))],
    totalDurationMin: raw.total_duration ?? 0,
  };
}

function parseSerpResponse(
  json: unknown,
  params: FlightSearchParams,
): { options: FlightOption[]; currency: string; hadResults: boolean } | null {
  if (typeof json !== "object" || json === null) return null;
  const body = json as SerpResponse;
  if (body.error) return null;
  if (body.search_metadata?.status && body.search_metadata.status !== "Success") {
    return null;
  }

  const currency = body.search_parameters?.currency ?? params.currency;
  const buckets = [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
  const options = buckets
    .map((bucket) => toOption(bucket, currency))
    .filter((option): option is FlightOption => option !== null);

  return { options, currency, hadResults: buckets.length > 0 };
}

export class SerpApiFlightSource implements FlightSource {
  readonly id = "serpapi";
  private readonly fetcher: JsonFetcher;
  private readonly apiKey: string;

  constructor(apiKey: string, fetcher: JsonFetcher = httpJsonFetcher) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  async search(params: FlightSearchParams): Promise<FlightSourceResult> {
    const degraded = (message: string): FlightSourceResult => ({
      options: [],
      currency: params.currency,
      structureVersion: SERPAPI_STRUCTURE_VERSION,
      degraded: true,
      message,
    });

    if ((params.flexDays ?? 0) > 0) return degraded("flex_unsupported");

    const query = new URLSearchParams({
      engine: "google_flights",
      type: params.tripType === "one_way" ? "2" : "1",
      departure_id: params.origin,
      arrival_id: params.destination,
      outbound_date: params.departDate,
      travel_class: String(TRAVEL_CLASS[params.cabinClass]),
      adults: String(params.adults),
      currency: params.currency,
      api_key: this.apiKey,
    });
    if (params.tripType === "round_trip" && params.returnDate) {
      query.set("return_date", params.returnDate);
    }
    if (params.stops === "non_stop") query.set("stops", "1");

    let response;
    try {
      response = await this.fetcher({
        url: `https://serpapi.com/search?${query.toString()}`,
        method: "GET",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return degraded(`fetch_failed:${message}`);
    }

    // 429 = monthly/hourly quota spent, 401/403 = bad key. Both are degradation
    // causes, never an empty result: the chain moves on to the next source.
    if (response.status < 200 || response.status >= 300) {
      return degraded(`http_${response.status}`);
    }

    const parsed = parseSerpResponse(parseJson(response.body), params);
    if (!parsed) return degraded("structure_mismatch:unparsable_response");

    // Results present but none survived parsing means the shape moved: degrade
    // instead of reporting a bogus "no flights".
    if (parsed.hadResults && parsed.options.length === 0) {
      return degraded("structure_mismatch:no_options_parsed");
    }

    return {
      options: parsed.options,
      currency: parsed.currency,
      structureVersion: SERPAPI_STRUCTURE_VERSION,
      degraded: false,
      ...(parsed.options.length === 0 ? { message: "no_flights" } : {}),
    };
  }

  // No cheap way to validate the key: every google_flights call spends quota, so
  // health stays structural and the chain relies on search() to detect a dead key.
  async health(): Promise<HealthStatus> {
    return { ok: true, structureVersion: SERPAPI_STRUCTURE_VERSION };
  }
}
