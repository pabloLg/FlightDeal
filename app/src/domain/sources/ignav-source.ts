import type { FlightSource } from "./flight-source";
import { httpJsonFetcher, parseJson, type JsonFetcher } from "./http-json";
import { optionKey } from "./option-key";
import type {
  FlightSearchParams,
  FlightOption,
  FlightOptionBookingLink,
  FlightLeg,
  FlightSourceResult,
  HealthStatus,
} from "./types";

export const IGNAV_STRUCTURE_VERSION = 2;

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
  ignav_id?: string;
}

interface IgnavBookingLink {
  provider_name?: string;
  provider_type?: string;
  price?: { amount?: number; currency?: string };
  url?: string;
}

interface IgnavBookingOption {
  links?: IgnavBookingLink[];
}

interface IgnavBookingResponse {
  error?: unknown;
  booking_options?: IgnavBookingOption[];
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
): {
  options: FlightOption[];
  /** ignav_id per option, aligned with options by index. */
  ignavIds: (string | undefined)[];
  hadResults: boolean;
} | null {
  if (typeof json !== "object" || json === null) return null;
  const body = json as { error?: unknown; itineraries?: IgnavItinerary[] };
  if (body.error) return null;
  if (!Array.isArray(body.itineraries)) return null;

  const options: FlightOption[] = [];
  const ignavIds: (string | undefined)[] = [];
  for (const itinerary of body.itineraries) {
    const option = toOption(itinerary, fallbackCurrency);
    if (option === null) continue;
    options.push(option);
    ignavIds.push(itinerary.ignav_id);
  }

  return { options, ignavIds, hadResults: body.itineraries.length > 0 };
}

// At most 3 purchase links per option: responses routinely carry ~5 sellers
// and each url is ~1KB of opaque provider handoff.
const MAX_BOOKING_LINKS = 3;

function parseBookingLinks(json: unknown): FlightOptionBookingLink[] | null {
  if (typeof json !== "object" || json === null) return null;
  const body = json as IgnavBookingResponse;
  if (body.error) return null;
  if (!Array.isArray(body.booking_options)) return null;

  const links: FlightOptionBookingLink[] = [];
  for (const item of body.booking_options) {
    if (!Array.isArray(item.links)) continue;
    for (const link of item.links) {
      const amount = link.price?.amount;
      // No price (or an unverified placeholder) is not a purchasable offer;
      // the generic Google link stays as fallback.
      if (
        typeof link.provider_name !== "string" ||
        typeof amount !== "number" ||
        typeof link.price?.currency !== "string" ||
        typeof link.url !== "string"
      ) {
        continue;
      }
      links.push({
        provider: link.provider_name,
        ...(typeof link.provider_type === "string"
          ? { providerType: link.provider_type }
          : {}),
        price: amount,
        currency: link.price.currency,
        url: link.url,
        method: "get",
      });
    }
  }
  links.sort((a, b) => a.price - b.price);
  return links.slice(0, MAX_BOOKING_LINKS);
}

export class IgnavFlightSource implements FlightSource {
  readonly id = "ignav";
  private readonly fetcher: JsonFetcher;
  private readonly apiKey: string;

  constructor(apiKey: string, fetcher: JsonFetcher = httpJsonFetcher) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  // Purchase links for the cheapest options (hybrid scope: top-3). One
  // booking-links request per option on the same account that ran the fare
  // search; failures are silent (generic Google link stays as fallback).
  private async attachBookingLinks(
    options: FlightOption[],
    ignavIds: (string | undefined)[],
    count = 3,
  ): Promise<FlightOption[]> {
    const order = options
      .map((option, i) => ({ option, i }))
      .sort((a, b) => a.option.price - b.option.price)
      .slice(0, count);
    const withLinks = new Map<number, FlightOptionBookingLink[]>();
    for (const { i } of order) {
      const ignavId = ignavIds[i];
      if (!ignavId) continue;
      let response;
      try {
        response = await this.fetcher({
          url: `${IGNAV_BASE_URL}/fares/booking-links`,
          method: "POST",
          headers: {
            "X-Api-Key": this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ignav_id: ignavId }),
        });
      } catch {
        continue;
      }
      if (response.status < 200 || response.status >= 300) continue;
      const links = parseBookingLinks(parseJson(response.body));
      if (links && links.length > 0) withLinks.set(i, links);
    }
    if (withLinks.size === 0) return options;
    return options.map((option, i) => {
      const links = withLinks.get(i);
      return links ? { ...option, bookingLinks: links } : option;
    });
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

    if (parsed.options.length === 0) {
      return {
        options: [],
        // Ignav has no currency parameter (only a market-local one); the price
        // currency is whatever the response reports.
        currency: params.currency,
        structureVersion: IGNAV_STRUCTURE_VERSION,
        degraded: false,
        message: "no_flights",
      };
    }

    const options = await this.attachBookingLinks(parsed.options, parsed.ignavIds);
    return {
      options,
      // Ignav has no currency parameter (only a market-local one); the price
      // currency is whatever the response reports.
      currency: parsed.options[0]?.currency ?? params.currency,
      structureVersion: IGNAV_STRUCTURE_VERSION,
      degraded: false,
    };
  }

  // Free /api/health endpoint, unlike a paid search probe.
  // NOTE: /api/health does NOT validate the API key (it answers 200 to
  // anything), so it cannot be used to check a credential. See
  // verifyCredential below for the check that actually proves a key.
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

  /**
   * Proves a stored or pasted credential works: an authenticated endpoint
   * that is not a fare search (GET /api/airports). /api/health answers 200 to
   * any string, so using it here would report a false positive on a bad key.
   *
   * ponytail: costs one request per call. The settings page renders a button
   * for a deliberate user action, and every other check is a real fare search.
   */
  async verifyCredential(): Promise<{
    ok: boolean;
    reason?: "invalid_key" | "billing" | "unreachable";
  }> {
    let response;
    try {
      response = await this.fetcher({
        url: `${IGNAV_BASE_URL}/airports?q=MAD`,
        method: "GET",
        headers: { "X-Api-Key": this.apiKey },
      });
    } catch {
      return { ok: false, reason: "unreachable" };
    }
    if (response.status >= 200 && response.status < 300) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "invalid_key" };
    }
    // 402 billing required, 429 spend cap: the key is fine but the account
    // cannot run searches, which is a different, actionable failure.
    if (response.status === 402) return { ok: false, reason: "billing" };
    return { ok: false, reason: "unreachable" };
  }
}
