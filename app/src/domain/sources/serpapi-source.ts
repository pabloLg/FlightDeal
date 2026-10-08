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

export const SERPAPI_STRUCTURE_VERSION = 3;

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
  departure_token?: string;
  booking_token?: string;
}

interface SerpResponse {
  error?: string;
  search_metadata?: { status?: string };
  search_parameters?: { currency?: string };
  best_flights?: SerpResult[];
  other_flights?: SerpResult[];
}

interface SerpBookingRequest {
  url?: string;
  post_data?: string;
}

interface SerpBookingOption {
  together?: {
    book_with?: string;
    price?: number;
    booking_request?: SerpBookingRequest;
  };
  separate_tickets?: boolean;
}

interface SerpBookingResponse {
  error?: string;
  booking_options?: SerpBookingOption[];
}

// Tokens per option, aligned with options by index. departure_token feeds the
// return-legs request; booking_token feeds the booking-options request.
interface SerpTokens {
  departure?: string;
  booking?: string;
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
): {
  options: FlightOption[];
  /** Tokens per option, aligned with options by index. */
  tokens: SerpTokens[];
  currency: string;
  hadResults: boolean;
} | null {
  if (typeof json !== "object" || json === null) return null;
  const body = json as SerpResponse;
  if (body.error) return null;
  if (body.search_metadata?.status && body.search_metadata.status !== "Success") {
    return null;
  }

  const currency = body.search_parameters?.currency ?? params.currency;
  const buckets = [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
  const parsed = buckets.map((bucket) => ({
    option: toOption(bucket, currency),
    tokens: {
      departure: bucket.departure_token,
      booking: bucket.booking_token,
    } as SerpTokens,
  }));
  const options: FlightOption[] = [];
  const tokens: SerpTokens[] = [];
  for (const { option, tokens: t } of parsed) {
    if (option === null) continue;
    options.push(option);
    tokens.push(t);
  }

  return { options, tokens, currency, hadResults: buckets.length > 0 };
}

// At most 3 provider links per option: each post_data blob is ~4KB and the
// response routinely carries ~20 sellers for the same itinerary.
const MAX_BOOKING_LINKS = 3;

function parseBookingResponse(
  json: unknown,
  currency: string,
): FlightOptionBookingLink[] | null {
  if (typeof json !== "object" || json === null) return null;
  const body = json as SerpBookingResponse;
  if (body.error) return null;
  if (!Array.isArray(body.booking_options)) return null;

  const links: FlightOptionBookingLink[] = [];
  for (const item of body.booking_options) {
    // separate_tickets branches need per-leg purchases; out of scope, the
    // generic Google link stays as fallback.
    const t = item.together;
    const url = t?.booking_request?.url;
    const postData = t?.booking_request?.post_data;
    if (
      typeof t?.book_with !== "string" ||
      typeof t?.price !== "number" ||
      typeof url !== "string" ||
      typeof postData !== "string"
    ) {
      continue;
    }
    links.push({
      provider: t.book_with,
      price: t.price,
      // together.price is quoted in the requested currency (verified live:
      // EUR requested → 127 against local_prices USD 142 for the same fare).
      currency,
      url,
      method: "post",
      postData,
    });
  }
  links.sort((a, b) => a.price - b.price);
  return links.slice(0, MAX_BOOKING_LINKS);
}

// Traceability for the second (return-legs) request. It rides on the result as
// an extra field so execute-search can copy it into raw_result without a
// schema change; the chain only ever reads degraded/options/message.
export type SerpReturnLegsStatus =
  | "attached"
  | "one_way"
  | "no_return_date"
  | "no_options"
  | "no_token"
  | "no_return_options"
  | "unparsable"
  | `second_request_failed:${string}`;

export class SerpApiFlightSource implements FlightSource {
  readonly id = "serpapi";
  private readonly fetcher: JsonFetcher;
  private readonly apiKey: string;

  constructor(apiKey: string, fetcher: JsonFetcher = httpJsonFetcher) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  private buildQuery(
    params: FlightSearchParams,
    tokens?: { departureToken?: string; bookingToken?: string },
  ) {
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
    // Selects the outbound and returns its return options. Cannot be combined
    // with booking_token; the booking request below sends the base params
    // plus booking_token instead (verified live: token alone 400s).
    if (tokens?.departureToken) query.set("departure_token", tokens.departureToken);
    if (tokens?.bookingToken) query.set("booking_token", tokens.bookingToken);
    return query;
  }

  // Third request: purchase links for one itinerary. Enrichment, never a
  // gate — without links the generic Google Flights link stays as fallback.
  private async attachBookingLinks(
    params: FlightSearchParams,
    currency: string,
    options: FlightOption[],
    cheapestIdx: number,
    bookingToken: string | undefined,
  ): Promise<FlightOption[]> {
    if (!bookingToken) return options;
    let response;
    try {
      response = await this.fetcher({
        url: `https://serpapi.com/search?${this.buildQuery(params, { bookingToken }).toString()}`,
        method: "GET",
      });
    } catch {
      return options;
    }
    if (response.status < 200 || response.status >= 300) return options;
    const links = parseBookingResponse(parseJson(response.body), currency);
    if (!links || links.length === 0) return options;
    return [
      ...options.slice(0, cheapestIdx),
      { ...options[cheapestIdx], bookingLinks: links },
      ...options.slice(cheapestIdx + 1),
    ];
  }

  // Enrichment, never a gate (same contract as the Google click-through): the
  // cheapest outbound keeps its round-trip total price and gains inboundLegs.
  // Returns the status for raw_result traceability.
  private async attachReturnLegs(
    params: FlightSearchParams,
    options: FlightOption[],
    tokens: SerpTokens[],
  ): Promise<{
    options: FlightOption[];
    returnLegs: SerpReturnLegsStatus;
    cheapestIdx: number;
    bookingToken: string | undefined;
  }> {
    let cheapestIdx = 0;
    for (let i = 1; i < options.length; i++) {
      if (options[i].price < options[cheapestIdx].price) cheapestIdx = i;
    }
    const token = tokens[cheapestIdx]?.departure;
    if (!token) return { options, returnLegs: "no_token", cheapestIdx, bookingToken: undefined };

    let response;
    try {
      response = await this.fetcher({
        url: `https://serpapi.com/search?${this.buildQuery(params, { departureToken: token }).toString()}`,
        method: "GET",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { options, returnLegs: `second_request_failed:${message}`, cheapestIdx, bookingToken: undefined };
    }
    if (response.status < 200 || response.status >= 300) {
      return { options, returnLegs: `second_request_failed:http_${response.status}`, cheapestIdx, bookingToken: undefined };
    }

    const parsed = parseSerpResponse(parseJson(response.body), params);
    if (!parsed) return { options, returnLegs: "unparsable", cheapestIdx, bookingToken: undefined };
    if (parsed.options.length === 0) return { options, returnLegs: "no_return_options", cheapestIdx, bookingToken: undefined };

    let cheapestReturn = parsed.options[0];
    let cheapestReturnIdx = 0;
    for (let i = 1; i < parsed.options.length; i++) {
      if (parsed.options[i].price < cheapestReturn.price) {
        cheapestReturn = parsed.options[i];
        cheapestReturnIdx = i;
      }
    }
    // The second response lists the return flights in `flights`, so they
    // become the inbound legs of the selected outbound. The price stays the
    // outbound's: SerpAPI quotes round-trip totals on the first response
    // (verified live 2026-10-07: cheapest out 125 = cheapest return 125).
    const outbound = options[cheapestIdx];
    const inboundLegs = cheapestReturn.outboundLegs;
    const enriched: FlightOption = {
      ...outbound,
      id: optionKey("sa", outbound.outboundLegs, inboundLegs),
      inboundLegs,
      airlines: [
        ...new Set([...outbound.airlines, ...cheapestReturn.airlines]),
      ],
      totalDurationMin:
        outbound.totalDurationMin + cheapestReturn.totalDurationMin,
    };
    return {
      options: [
        ...options.slice(0, cheapestIdx),
        enriched,
        ...options.slice(cheapestIdx + 1),
      ],
      returnLegs: "attached",
      cheapestIdx,
      // The return response carries the booking_token that buys the whole
      // itinerary; the third request uses it.
      bookingToken: parsed.tokens[cheapestReturnIdx]?.booking,
    };
  }

  async search(
    params: FlightSearchParams,
  ): Promise<FlightSourceResult & { returnLegs?: SerpReturnLegsStatus }> {
    const degraded = (message: string): FlightSourceResult => ({
      options: [],
      currency: params.currency,
      structureVersion: SERPAPI_STRUCTURE_VERSION,
      degraded: true,
      message,
    });

    if ((params.flexDays ?? 0) > 0) return degraded("flex_unsupported");

    const query = this.buildQuery(params);

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

    if (parsed.options.length === 0) {
      return {
        options: [],
        currency: parsed.currency,
        structureVersion: SERPAPI_STRUCTURE_VERSION,
        degraded: false,
        message: "no_flights",
        returnLegs: "no_options",
      };
    }

    // Only the cheapest outbound earns the extra requests: return legs plus
    // booking links are 2 more searches per run, affordable only single-pick
    // (ponytail: same rule as the Google return-legs enrichment).
    if (params.tripType !== "round_trip") {
      let cheapestIdx = 0;
      for (let i = 1; i < parsed.options.length; i++) {
        if (parsed.options[i].price < parsed.options[cheapestIdx].price) cheapestIdx = i;
      }
      // One-way responses carry booking_token directly (no departure_token).
      const options = await this.attachBookingLinks(
        params,
        parsed.currency,
        parsed.options,
        cheapestIdx,
        parsed.tokens[cheapestIdx]?.booking,
      );
      return {
        options,
        currency: parsed.currency,
        structureVersion: SERPAPI_STRUCTURE_VERSION,
        degraded: false,
        returnLegs: "one_way",
      };
    }
    if (!params.returnDate) {
      return {
        options: parsed.options,
        currency: parsed.currency,
        structureVersion: SERPAPI_STRUCTURE_VERSION,
        degraded: false,
        returnLegs: "no_return_date",
      };
    }

    const {
      options: withReturn,
      returnLegs,
      cheapestIdx,
      bookingToken,
    } = await this.attachReturnLegs(params, parsed.options, parsed.tokens);
    const options = await this.attachBookingLinks(
      params,
      parsed.currency,
      withReturn,
      cheapestIdx,
      bookingToken,
    );
    return {
      options,
      currency: parsed.currency,
      structureVersion: SERPAPI_STRUCTURE_VERSION,
      degraded: false,
      returnLegs,
    };
  }

  // No cheap way to validate the key: every google_flights call spends quota, so
  // health stays structural and the chain relies on search() to detect a dead key.
  async health(): Promise<HealthStatus> {
    return { ok: true, structureVersion: SERPAPI_STRUCTURE_VERSION };
  }
}
