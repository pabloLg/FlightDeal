import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import type { JsonFetcher, JsonRequest } from "./http-json";
import { SerpApiFlightSource } from "./serpapi-source";
import type { FlightSearchParams } from "./types";

const fixture = fs
  .readFileSync(path.join(__dirname, "fixtures", "serpapi-mad-bcn.json"), "utf8")
  .replace(/^\uFEFF/, "");

// Live captures 2026-10-07 (round-trip MAD→BCN 2026-11-15/22): the first
// response carries departure_token per option, the second is the answer to
// the cheapest token (return legs BCN→MAD).
const roundtripFixture = fs
  .readFileSync(path.join(__dirname, "fixtures", "serpapi-mad-bcn-roundtrip.json"), "utf8")
  .replace(/^\uFEFF/, "");

const returnFixture = fs
  .readFileSync(path.join(__dirname, "fixtures", "serpapi-mad-bcn-return.json"), "utf8")
  .replace(/^\uFEFF/, "");

const bookingFixture = fs
  .readFileSync(path.join(__dirname, "fixtures", "serpapi-booking-options.json"), "utf8")
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

  it("keeps inboundLegs empty without departure_token", async () => {
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

describe("SerpApiFlightSource return legs", () => {
  function stubSequence(calls: { body: string; status?: number }[]) {
    const seen: JsonRequest[] = [];
    let i = 0;
    const fetcher: JsonFetcher = async (request) => {
      seen.push(request);
      const call = calls[Math.min(i++, calls.length - 1)];
      return { status: call.status ?? 200, body: call.body };
    };
    return { fetcher, seen };
  }

  it("attaches the cheapest return legs to the cheapest outbound only", async () => {
    const { fetcher, seen } = stubSequence([
      { body: roundtripFixture },
      { body: returnFixture },
    ]);
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(false);
    // Search + return legs + booking attempt (the clamped stub answers the
    // booking call with the return body, which carries no booking_options).
    expect(seen).toHaveLength(3);
    const firstToken = JSON.parse(roundtripFixture).best_flights[0].departure_token;
    expect(new URL(seen[1].url).searchParams.get("departure_token")).toBe(firstToken);

    const cheapest = result.options.find((o) => o.price === 125);
    expect(cheapest?.inboundLegs).toHaveLength(1);
    expect(cheapest?.inboundLegs[0]).toMatchObject({
      departAirport: "BCN",
      arriveAirport: "MAD",
      flightNumber: "VY 1008",
    });
    // The first-response price is already the round-trip total (verified live
    // 2026-10-07), so it is kept, not replaced by the return price.
    expect(cheapest?.price).toBe(125);
    expect(
      result.options.filter((o) => o.price !== 125).every((o) => o.inboundLegs.length === 0),
    ).toBe(true);
    expect((result as { returnLegs?: string }).returnLegs).toBe("attached");
  });

  it("keeps the outbound when the second request throws", async () => {
    let calls = 0;
    const fetcher: JsonFetcher = async () => {
      calls++;
      if (calls === 1) return { status: 200, body: roundtripFixture };
      throw new Error("socket hang up");
    };
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(false);
    expect(result.options.every((o) => o.inboundLegs.length === 0)).toBe(true);
    expect((result as { returnLegs?: string }).returnLegs).toBe(
      "second_request_failed:socket hang up",
    );
  });

  it("keeps the outbound when the second request hits quota", async () => {
    const { fetcher } = stubSequence([
      { body: roundtripFixture },
      { body: "Too Many Requests", status: 429 },
    ]);
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(false);
    expect(result.options.every((o) => o.inboundLegs.length === 0)).toBe(true);
    expect((result as { returnLegs?: string }).returnLegs).toBe(
      "second_request_failed:http_429",
    );
  });

  it("makes a single request when the cheapest option has no token", async () => {
    const payload = JSON.parse(roundtripFixture);
    delete payload.best_flights[0].departure_token;
    const { fetcher, seen } = stubSequence([{ body: JSON.stringify(payload) }]);
    const result = await source(fetcher).search(params);

    expect(seen).toHaveLength(1);
    expect(result.degraded).toBe(false);
    expect((result as { returnLegs?: string }).returnLegs).toBe("no_token");
  });

  it("makes a single request for one way", async () => {
    const { fetcher, seen } = stubSequence([{ body: roundtripFixture }]);
    const result = await source(fetcher).search({ ...params, tripType: "one_way" });

    expect(seen).toHaveLength(1);
    expect(result.degraded).toBe(false);
    expect(result.options.every((o) => o.inboundLegs.length === 0)).toBe(true);
    expect((result as { returnLegs?: string }).returnLegs).toBe("one_way");
  });

  it("keeps the outbound when the return search comes back empty", async () => {
    const { fetcher } = stubSequence([
      { body: roundtripFixture },
      { body: JSON.stringify({ best_flights: [], other_flights: [] }) },
    ]);
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(false);
    expect(result.options.every((o) => o.inboundLegs.length === 0)).toBe(true);
    expect((result as { returnLegs?: string }).returnLegs).toBe("no_return_options");
  });

  it("keeps the outbound when the return payload is unparsable", async () => {
    const { fetcher } = stubSequence([
      { body: roundtripFixture },
      { body: "<html>not json</html>" },
    ]);
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(false);
    expect((result as { returnLegs?: string }).returnLegs).toBe("unparsable");
  });
});

describe("SerpApiFlightSource booking links", () => {
  function stubSequence(calls: { body: string; status?: number }[]) {
    const seen: JsonRequest[] = [];
    let i = 0;
    const fetcher: JsonFetcher = async (request) => {
      seen.push(request);
      const call = calls[Math.min(i++, calls.length - 1)];
      return { status: call.status ?? 200, body: call.body };
    };
    return { fetcher, seen };
  }

  it("attaches the cheapest provider links to the cheapest option", async () => {
    const { fetcher, seen } = stubSequence([
      { body: roundtripFixture },
      { body: returnFixture },
      { body: bookingFixture },
    ]);
    const result = await source(fetcher).search(params);

    expect(seen).toHaveLength(3);
    expect(new URL(seen[2].url).searchParams.get("booking_token")).toBe(
      JSON.parse(returnFixture).best_flights[0].booking_token,
    );
    const cheapest = result.options.find((o) => o.price === 125);
    expect(cheapest?.bookingLinks?.map((l) => l.provider)).toEqual([
      "BudgetAir",
      "Air Europa",
      "Booking.com",
    ]);
    expect(cheapest?.bookingLinks?.[0]).toMatchObject({
      price: 127,
      currency: "EUR",
      url: "https://www.google.com/travel/clk/f",
      method: "post",
    });
    expect(typeof cheapest?.bookingLinks?.[0].postData).toBe("string");
    expect(
      result.options.filter((o) => o.price !== 125).every((o) => o.bookingLinks === undefined),
    ).toBe(true);
  });

  it("keeps the enriched option when the booking request fails", async () => {
    const { fetcher } = stubSequence([
      { body: roundtripFixture },
      { body: returnFixture },
      { body: "Too Many Requests", status: 429 },
    ]);
    const result = await source(fetcher).search(params);

    expect(result.degraded).toBe(false);
    const cheapest = result.options.find((o) => o.price === 125);
    expect(cheapest?.inboundLegs).toHaveLength(1);
    expect(cheapest?.bookingLinks).toBeUndefined();
  });

  it("fetches booking links on one way from the first-response token", async () => {
    const payload = JSON.parse(roundtripFixture);
    payload.best_flights[0].booking_token = "dG9rZW4=";
    const { fetcher, seen } = stubSequence([
      { body: JSON.stringify(payload) },
      { body: bookingFixture },
    ]);
    const result = await source(fetcher).search({ ...params, tripType: "one_way" });

    expect(seen).toHaveLength(2);
    expect(result.options[0].bookingLinks).toHaveLength(3);
  });
});
