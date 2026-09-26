import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import type { JsonFetcher, JsonRequest } from "./http-json";
import { SerpApiFlightSource } from "./serpapi-source";
import type { FlightSearchParams } from "./types";

const fixture = fs
  .readFileSync(path.join(__dirname, "fixtures", "serpapi-mad-bcn.json"), "utf8")
  .replace(/^\uFEFF/, "");

const params: FlightSearchParams = {
  origin: "MAD",
  destination: "BCN",
  departDate: "2026-10-15",
  returnDate: "2026-10-22",
  tripType: "round_trip",
  cabinClass: "economy",
  stops: "non_stop",
  adults: 1,
  currency: "EUR",
};

function stubFetcher(body: string, status = 200) {
  const seen: JsonRequest[] = [];
  const fetcher: JsonFetcher = async (request) => {
    seen.push(request);
    return { status, body };
  };
  return { fetcher, seen };
}

function source(fetcher: JsonFetcher) {
  return new SerpApiFlightSource("test-key", fetcher);
}

describe("SerpApiFlightSource", () => {
  it("maps best_flights and other_flights into options", async () => {
    const { fetcher } = stubFetcher(fixture);
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(false);
    expect(result.options.map((o) => o.price)).toEqual([74, 61, 48]);
    expect(result.currency).toBe("EUR");
  });

  it("maps segment times to ISO local strings", async () => {
    const { fetcher } = stubFetcher(fixture);
    const result = await source(fetcher).search(params);

    expect(result.options[0].outboundLegs[0]).toEqual({
      airline: "Iberia",
      flightNumber: "IB 3107",
      departAirport: "MAD",
      arriveAirport: "BCN",
      departAt: "2026-10-15T06:00:00",
      arriveAt: "2026-10-15T07:35:00",
      durationMin: 95,
    });
    expect(result.options[0].totalDurationMin).toBe(95);
  });

  it("leaves inboundLegs empty: return legs need a second request", async () => {
    const { fetcher } = stubFetcher(fixture);
    const result = await source(fetcher).search(params);

    expect(result.options.every((o) => o.inboundLegs.length === 0)).toBe(true);
  });

  it("produces stable dedupe keys when results are reordered", async () => {
    const { fetcher: fetcherA } = stubFetcher(fixture);
    const first = await source(fetcherA).search(params);

    const payload = JSON.parse(fixture);
    const reversed = JSON.stringify({
      ...payload,
      best_flights: [...payload.best_flights].reverse(),
      other_flights: [...payload.other_flights].reverse(),
    });
    const { fetcher: fetcherB } = stubFetcher(reversed);
    const second = await source(fetcherB).search(params);

    expect(second.options.map((o) => o.id).sort()).toEqual(
      first.options.map((o) => o.id).sort(),
    );
  });

  it("sends the documented round-trip and nonstop encoding", async () => {
    const { fetcher, seen } = stubFetcher(fixture);
    await source(fetcher).search(params);

    const query = new URL(seen[0].url).searchParams;
    expect(query.get("type")).toBe("1");
    expect(query.get("stops")).toBe("1");
    expect(query.get("travel_class")).toBe("1");
    expect(query.get("return_date")).toBe("2026-10-22");
    expect(query.get("currency")).toBe("EUR");
  });

  it("encodes one way as type=2 without a return date", async () => {
    const { fetcher, seen } = stubFetcher(fixture);
    await source(fetcher).search({ ...params, tripType: "one_way" });

    const query = new URL(seen[0].url).searchParams;
    expect(query.get("type")).toBe("2");
    expect(query.get("return_date")).toBeNull();
  });

  it("omits the stops filter when any number of stops is allowed", async () => {
    const { fetcher, seen } = stubFetcher(fixture);
    await source(fetcher).search({ ...params, stops: "any" });

    expect(new URL(seen[0].url).searchParams.has("stops")).toBe(false);
  });

  it("degrades on quota exhaustion instead of reporting no flights", async () => {
    const { fetcher } = stubFetcher("Too Many Requests", 429);
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(true);
    expect(result.message).toBe("http_429");
    expect(result.options).toEqual([]);
  });

  it("degrades on an invalid key", async () => {
    const { fetcher } = stubFetcher(JSON.stringify({ error: "Invalid API key" }), 401);
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(true);
    expect(result.message).toBe("http_401");
  });

  it("degrades on an error payload with a 200 status", async () => {
    const { fetcher } = stubFetcher(JSON.stringify({ error: "Invalid API key" }));
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(true);
    expect(result.message).toBe("structure_mismatch:unparsable_response");
  });

  it("degrades when the search is still processing", async () => {
    const { fetcher } = stubFetcher(
      JSON.stringify({ search_metadata: { status: "Processing" } }),
    );
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(true);
  });

  it("degrades on malformed JSON", async () => {
    const { fetcher } = stubFetcher("<html>not json</html>");
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(true);
  });

  it("degrades when results exist but none can be parsed", async () => {
    const { fetcher } = stubFetcher(
      JSON.stringify({ best_flights: [{ flights: [], price: 10 }], other_flights: [] }),
    );
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(true);
    expect(result.message).toBe("structure_mismatch:no_options_parsed");
  });

  it("reports an empty result set as no_flights, not as a failure", async () => {
    const { fetcher } = stubFetcher(
      JSON.stringify({ best_flights: [], other_flights: [] }),
    );
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(false);
    expect(result.message).toBe("no_flights");
  });

  it("degrades on flexDays because SerpAPI has no flexible-date search", async () => {
    const { fetcher, seen } = stubFetcher(fixture);
    const result = await source(fetcher).search({ ...params, flexDays: 3 });

    expect(result.degraded).toBe(true);
    expect(result.message).toBe("flex_unsupported");
    expect(seen).toHaveLength(0);
  });

  it("degrades when the transport throws", async () => {
    const fetcher: JsonFetcher = async () => {
      throw new Error("socket hang up");
    };
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(true);
    expect(result.message).toBe("fetch_failed:socket hang up");
  });
});
