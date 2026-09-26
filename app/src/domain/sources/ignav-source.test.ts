import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import type { JsonFetcher, JsonRequest } from "./http-json";
import { IgnavFlightSource } from "./ignav-source";
import type { FlightSearchParams } from "./types";

const fixture = fs
  .readFileSync(path.join(__dirname, "fixtures", "ignav-mad-bcn.json"), "utf8")
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
  return new IgnavFlightSource("test-key", fetcher);
}

function oneWayBody() {
  const payload = JSON.parse(fixture);
  return JSON.stringify({
    ...payload,
    itineraries: payload.itineraries.map((itinerary: Record<string, unknown>) => {
      const copy = { ...itinerary };
      delete copy.inbound;
      return copy;
    }),
  });
}

describe("IgnavFlightSource", () => {
  it("maps every itinerary", async () => {
    const { fetcher } = stubFetcher(fixture);
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(false);
    expect(result.options.map((o) => o.price)).toEqual([132, 97]);
  });

  it("maps the return leg delivered in the same response", async () => {
    const { fetcher } = stubFetcher(fixture);
    const result = await source(fetcher).search(params);

    expect(result.options[0].inboundLegs[0]).toEqual({
      airline: "IB",
      flightNumber: "IB3120",
      departAirport: "BCN",
      arriveAirport: "MAD",
      departAt: "2026-10-22T20:30:00",
      arriveAt: "2026-10-22T22:10:00",
      durationMin: 100,
    });
  });

  it("sums outbound and inbound duration", async () => {
    const { fetcher } = stubFetcher(fixture);
    const result = await source(fetcher).search(params);

    expect(result.options[0].totalDurationMin).toBe(195);
    expect(result.options[0].airlines).toEqual(["IB"]);
  });

  it("takes the currency from the response, not from the request", async () => {
    const payload = JSON.parse(fixture);
    payload.itineraries[0].price.currency = "USD";
    const { fetcher } = stubFetcher(JSON.stringify(payload));
    const result = await source(fetcher).search({ ...params, currency: "GBP" });

    expect(result.options[0].currency).toBe("USD");
    expect(result.currency).toBe("USD");
  });

  it("posts to the round-trip route with the api key header", async () => {
    const { fetcher, seen } = stubFetcher(fixture);
    await source(fetcher).search(params);

    expect(seen[0].url).toBe("https://ignav.com/api/fares/round-trip");
    expect(seen[0].method).toBe("POST");
    expect(seen[0].headers?.["X-Api-Key"]).toBe("test-key");
    const body = JSON.parse(seen[0].body ?? "{}");
    expect(body).toMatchObject({
      origin: "MAD",
      destination: "BCN",
      departure_date: "2026-10-15",
      return_date: "2026-10-22",
      adults: 1,
      cabin_class: "economy",
      max_stops: 0,
    });
  });

  it("uses the one-way route and leaves inboundLegs empty", async () => {
    const { fetcher, seen } = stubFetcher(oneWayBody());
    const result = await source(fetcher).search({ ...params, tripType: "one_way" });

    expect(seen[0].url).toBe("https://ignav.com/api/fares/one-way");
    expect(JSON.parse(seen[0].body ?? "{}").return_date).toBeUndefined();
    expect(result.options[0].inboundLegs).toEqual([]);
  });

  it("omits max_stops when any number of stops is allowed", async () => {
    const { fetcher, seen } = stubFetcher(fixture);
    await source(fetcher).search({ ...params, stops: "any" });

    expect(JSON.parse(seen[0].body ?? "{}").max_stops).toBeUndefined();
  });

  it.each([
    [401, "invalid key"],
    [402, "billing required"],
    [424, "upstream failure"],
    [429, "spend limit reached"],
  ])("degrades on http %i (%s)", async (status) => {
    const { fetcher } = stubFetcher(JSON.stringify({ error: { type: "x" } }), status);
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(true);
    expect(result.message).toBe(`http_${status}`);
    expect(result.options).toEqual([]);
  });

  it("degrades on a documented error payload", async () => {
    const { fetcher } = stubFetcher(
      JSON.stringify({
        error: { type: "invalid_request", code: "invalid_airport_code", message: "bad" },
      }),
    );
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(true);
  });

  it("degrades when itineraries exist but none can be parsed", async () => {
    const { fetcher } = stubFetcher(
      JSON.stringify({ itineraries: [{ price: { amount: 10, currency: "EUR" } }] }),
    );
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(true);
    expect(result.message).toBe("structure_mismatch:no_options_parsed");
  });

  it("reports an empty result set as no_flights", async () => {
    const { fetcher } = stubFetcher(JSON.stringify({ itineraries: [] }));
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(false);
    expect(result.message).toBe("no_flights");
  });

  it("degrades on flexDays because flexible search is not implemented", async () => {
    const { fetcher, seen } = stubFetcher(fixture);
    const result = await source(fetcher).search({ ...params, flexDays: 3 });

    expect(result.degraded).toBe(true);
    expect(result.message).toBe("flex_unsupported");
    expect(seen).toHaveLength(0);
  });

  it("degrades when the transport throws", async () => {
    const fetcher: JsonFetcher = async () => {
      throw new Error("ECONNRESET");
    };
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(true);
    expect(result.message).toBe("fetch_failed:ECONNRESET");
  });
});
