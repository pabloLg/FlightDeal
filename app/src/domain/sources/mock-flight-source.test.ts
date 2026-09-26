import { describe, expect, it } from "vitest";

import { MockFlightSource } from "./mock-flight-source";

const base = {
  origin: "MAD",
  destination: "BCN",
  departDate: "2026-12-10",
  returnDate: "2026-12-17",
  tripType: "round_trip" as const,
  cabinClass: "economy" as const,
  stops: "any" as const,
  adults: 1,
  currency: "EUR",
};

describe("MockFlightSource", () => {
  it("returns deterministic prices for the same route", async () => {
    const source = new MockFlightSource();
    const a = await source.search(base);
    const b = await source.search(base);
    expect(a.options.map((o) => o.price)).toEqual(b.options.map((o) => o.price));
  });

  it("returns 3 options with outbound+inbound legs for round trips", async () => {
    const { options } = await new MockFlightSource().search(base);
    expect(options).toHaveLength(3);
    expect(options[0].outboundLegs).toHaveLength(1);
    expect(options[0].inboundLegs).toHaveLength(1);
    expect(options[0].price).toBeGreaterThan(0);
  });

  it("returns no inbound legs for one-way trips", async () => {
    const { options } = await new MockFlightSource().search({
      ...base,
      tripType: "one_way",
      returnDate: undefined,
    });
    expect(options[0].inboundLegs).toHaveLength(0);
  });

  it("returns empty results for the XXX destination (fixture no-results)", async () => {
    const result = await new MockFlightSource().search({
      ...base,
      destination: "XXX",
    });
    expect(result.options).toHaveLength(0);
    expect(result.message).toBe("no_flights");
  });

  it("spans the flex window with one option per day when flexDays is set", async () => {
    const source = new MockFlightSource();
    const { options } = await source.search({ ...base, flexDays: 2 });
    expect(options).toHaveLength(5); // -2..+2
    const dates = options.map((o) => o.outboundLegs[0].departAt.slice(0, 10));
    expect(dates).toEqual([
      "2026-12-08",
      "2026-12-09",
      "2026-12-10",
      "2026-12-11",
      "2026-12-12",
    ]);
    // deterministic across runs
    const again = await source.search({ ...base, flexDays: 2 });
    expect(again.options.map((o) => o.id)).toEqual(options.map((o) => o.id));
  });
});