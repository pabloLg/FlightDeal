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

export const SERPAPI_STRUCTURE_VERSION = 2;

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
  /** departure_token per option, aligned with options by index. */
  tokens: (string | undefined)[];
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
    token: bucket.departure_token,
  }));
  const options: FlightOption[] = [];
  const tokens: (string | undefined)[] = [];
  for (const { option, token } of parsed) {
    if (option === null) continue;
    options.push(option);
    tokens.push(token);
  }

  return { options, tokens, currency, hadResults: buckets.length > 0 };
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

  private buildQuery(params: FlightSearchParams, departureToken?: string) {
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
    // with booking_token (which we never send).
    if (departureToken) query.set("departure_token", departureToken);
    return query;
  }

  // Enrichment, never a gate (same contract as the Google click-through): the
  // cheapest outbound keeps its round-trip total price and gains inboundLegs.
  // Returns the status for raw_result traceability.
  private async attachReturnLegs(
    params: FlightSearchParams,
    options: FlightOption[],
    tokens: (string | undefined)[],
  ): Promise<{ options: FlightOption[]; returnLegs: SerpReturnLegsStatus }> {
    let cheapestIdx = 0;
    for (let i = 1; i < options.length; i++) {
      if (options[i].price < options[cheapestIdx].price) cheapestIdx = i;
    }
    const token = tokens[cheapestIdx];
    if (!token) return { options, returnLegs: "no_token" };

    let response;
    try {
      response = await this.fetcher({
        url: `https://serpapi.com/search?${this.buildQuery(params, token).toString()}`,
        method: "GET",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { options, returnLegs: `second_request_failed:${message}` };
    }
    if (response.status < 200 || response.status >= 300) {
      return { options, returnLegs: `second_request_failed:http_${response.status}` };
    }

    const parsed = parseSerpResponse(parseJson(response.body), params);
    if (!parsed) return { options, returnLegs: "unparsable" };
    if (parsed.options.length === 0) return { options, returnLegs: "no_return_options" };

    let cheapestReturn = parsed.options[0];
    for (const option of parsed.options) {
      if (option.price < cheapestReturn.price) cheapestReturn = option;
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

    // Only the cheapest outbound earns the second request: one extra search
    // per run keeps the 250/month quota affordable (ponytail: same single-pick
    // rule as the Google return-legs enrichment).
    if (params.tripType !== "round_trip") {
      return {
        options: parsed.options,
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

    const { options, returnLegs } = await this.attachReturnLegs(
      params,
      parsed.options,
      parsed.tokens,
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
