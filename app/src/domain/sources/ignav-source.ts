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

export const IGNAV_STRUCTURE_VERSION = 1;

const IGNAV_BASE_URL = "https://ignav.com/api";
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

interface IgnavSegment {
  marketing_carrier_code?: string;
  flight_number?: string;
  departure_airport?: string;
  departure_time_local?: string;
  arrival_airport?: string;
  arrival_time_local?: string;
  duration_minutes?: number;
}

interface IgnavLeg {
  segments?: IgnavSegment[];
}

interface IgnavItinerary {
  price?: { amount?: number; currency?: string };
  outbound?: IgnavLeg;
  inbound?: IgnavLeg;
}

// Ignav already returns departure_time_local as "YYYY-MM-DDTHH:MM:SS", which is
// the exact shape FlightLeg stores, so this only normalises the optional seconds.
function toIsoLocal(raw: string | undefined): string | null {
  if (!raw || !LOCAL_ISO.test(raw)) return null;
  return raw.length === 16 ? `${raw}:00` : raw;
}

function toLegs(leg: IgnavLeg | undefined): FlightLeg[] | null {
  if (!leg || !Array.isArray(leg.segments) || leg.segments.length === 0) return null;

  const legs: FlightLeg[] = [];
  for (const segment of leg.segments) {
    const code = segment.marketing_carrier_code;
    const departAirport = segment.departure_airport;
    const arriveAirport = segment.arrival_airport;
    const departAt = toIsoLocal(segment.departure_time_local);
    const arriveAt = toIsoLocal(segment.arrival_time_local);
    if (!code || !departAirport || !arriveAirport || !departAt || !arriveAt) {
      return null;
    }
    legs.push({
      airline: code,
      flightNumber: `${code}${segment.flight_number ?? ""}`,
      departAirport,
      arriveAirport,
      departAt,
      arriveAt,
      durationMin: segment.duration_minutes ?? 0,
    });
  }
  return legs;
}

function toOption(
  itinerary: IgnavItinerary,
  fallbackCurrency: string,
): FlightOption | null {
  const amount = itinerary.price?.amount;
  const currency = itinerary.price?.currency ?? fallbackCurrency;
  if (typeof amount !== "number") return null;

  const outboundLegs = toLegs(itinerary.outbound);
  if (!outboundLegs) return null;
  // Round-trip itineraries carry the return leg in the same response, so
  // inboundLegs are complete here (unlike the Google-shaped sources).
  const inboundLegs = itinerary.inbound ? toLegs(itinerary.inbound) : [];
  if (inboundLegs === null) return null;

  const totalDurationMin = [
    ...outboundLegs,
    ...inboundLegs,
  ].reduce((sum, leg) => sum + leg.durationMin, 0);

  return {
    // ignav_id is itinerary-scoped and not stable across dates; segments are.
    id: optionKey("ig", outboundLegs, inboundLegs),
    price: amount,
    currency,
    outboundLegs,
    inboundLegs,
    airlines: [...new Set([...outboundLegs, ...inboundLegs].map((leg) => leg.airline))],
    totalDurationMin,
  };
}

function parseIgnavResponse(
  json: unknown,
  fallbackCurrency: string,
): { options: FlightOption[]; hadResults: boolean } | null {
  if (typeof json !== "object" || json === null) return null;
  const body = json as { error?: unknown; itineraries?: IgnavItinerary[] };
  if (body.error) return null;
  if (!Array.isArray(body.itineraries)) return null;

  const options = body.itineraries
    .map((itinerary) => toOption(itinerary, fallbackCurrency))
    .filter((option): option is FlightOption => option !== null);

  return { options, hadResults: body.itineraries.length > 0 };
}

export class IgnavFlightSource implements FlightSource {
  readonly id = "ignav";
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
      structureVersion: IGNAV_STRUCTURE_VERSION,
      degraded: true,
      message,
    });

    if ((params.flexDays ?? 0) > 0) return degraded("flex_unsupported");

    const isRoundTrip = params.tripType === "round_trip" && !!params.returnDate;
    const body: Record<string, unknown> = {
      origin: params.origin,
      destination: params.destination,
      departure_date: params.departDate,
      adults: params.adults,
      cabin_class: params.cabinClass,
    };
    if (isRoundTrip) body.return_date = params.returnDate;
    if (params.stops === "non_stop") body.max_stops = 0;

    let response;
    try {
      response = await this.fetcher({
        url: `${IGNAV_BASE_URL}/fares/${isRoundTrip ? "round-trip" : "one-way"}`,
        method: "POST",
        headers: {
          "X-Api-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return degraded(`fetch_failed:${message}`);
    }

    // 401 invalid key, 402 billing required, 424 upstream failure, 429 spend cap.
    // None of them mean "no flights"; the chain must move to the next source.
    if (response.status < 200 || response.status >= 300) {
      return degraded(`http_${response.status}`);
    }

    const parsed = parseIgnavResponse(parseJson(response.body), params.currency);
    if (!parsed) return degraded("structure_mismatch:unparsable_response");

    if (parsed.hadResults && parsed.options.length === 0) {
      return degraded("structure_mismatch:no_options_parsed");
    }

    return {
      options: parsed.options,
      // Ignav has no currency parameter (only a market-local one); the price
      // currency is whatever the response reports.
      currency: parsed.options[0]?.currency ?? params.currency,
      structureVersion: IGNAV_STRUCTURE_VERSION,
      degraded: false,
      ...(parsed.options.length === 0 ? { message: "no_flights" } : {}),
    };
  }

  // Free /api/health endpoint, unlike a paid search probe.
  async health(): Promise<HealthStatus> {
    try {
      const response = await this.fetcher({
        url: `${IGNAV_BASE_URL}/health`,
        method: "GET",
        headers: { "X-Api-Key": this.apiKey },
      });
      return { ok: response.status >= 200 && response.status < 300, structureVersion: IGNAV_STRUCTURE_VERSION };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, structureVersion: IGNAV_STRUCTURE_VERSION, message };
    }
  }
}
