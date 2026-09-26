import { describe, expect, it } from "vitest";

import { resolveChain, searchWithFailover } from "./chain";
import type { FlightSource } from "./flight-source";
import type {
  FlightSearchParams,
  FlightSourceResult,
  HealthStatus,
} from "./types";

const params: FlightSearchParams = {
  origin: "MAD",
  destination: "BCN",
  departDate: "2026-10-15",
  tripType: "one_way",
  cabinClass: "economy",
  stops: "any",
  adults: 1,
  currency: "EUR",
};

const ok = (id: string): FlightSourceResult => ({
  options: [
    {
      id: `${id}-option`,
      price: 50,
      currency: "EUR",
      outboundLegs: [],
      inboundLegs: [],
      airlines: [],
      totalDurationMin: 90,
    },
  ],
  currency: "EUR",
  structureVersion: 1,
  degraded: false,
});

const degraded = (reason: string): FlightSourceResult => ({
  options: [],
  currency: "EUR",
  structureVersion: 1,
  degraded: true,
  message: reason,
});

class StubSource implements FlightSource {
  readonly id: string;
  private readonly behaviour: () => Promise<FlightSourceResult>;

  constructor(id: string, behaviour: () => Promise<FlightSourceResult>) {
    this.id = id;
    this.behaviour = behaviour;
  }

  async search(): Promise<FlightSourceResult> {
    return this.behaviour();
  }

  async health(): Promise<HealthStatus> {
    return { ok: true };
  }
}

const stub = (id: string, result: FlightSourceResult) =>
  new StubSource(id, async () => result);

const throwing = (id: string, error: Error) =>
  new StubSource(id, async () => {
    throw error;
  });

describe("searchWithFailover", () => {
  it("stops at the first non-degraded source", async () => {
    const outcome = await searchWithFailover(
      [stub("first", ok("first")), stub("second", ok("second"))],
      params,
    );

    expect(outcome.sourceId).toBe("first");
    expect(outcome.result.degraded).toBe(false);
    expect(outcome.attempts).toHaveLength(1);
  });

  it("falls over to the next source after a degradation", async () => {
    const outcome = await searchWithFailover(
      [stub("serpapi", degraded("http_429")), stub("ignav", ok("ignav"))],
      params,
    );

    expect(outcome.sourceId).toBe("ignav");
    expect(outcome.result.options[0].id).toBe("ignav-option");
    expect(outcome.attempts).toEqual([
      { sourceId: "serpapi", degraded: true, message: "http_429" },
      { sourceId: "ignav", degraded: false },
    ]);
  });

  it("does not fail over on a legitimate no_flights result", async () => {
    const outcome = await searchWithFailover(
      [stub("first", { ...ok("first"), options: [], message: "no_flights" }), stub("second", ok("second"))],
      params,
    );

    expect(outcome.sourceId).toBe("first");
    expect(outcome.result.message).toBe("no_flights");
    expect(outcome.attempts).toHaveLength(1);
  });

  it("returns the last degradation when every source fails", async () => {
    const outcome = await searchWithFailover(
      [stub("serpapi", degraded("http_429")), stub("ignav", degraded("http_402"))],
      params,
    );

    expect(outcome.result.degraded).toBe(true);
    expect(outcome.result.message).toBe("http_402");
    expect(outcome.sourceId).toBe("ignav");
  });

  it("treats an empty chain as degraded instead of succeeding empty", async () => {
    const outcome = await searchWithFailover([], params);

    expect(outcome.result.degraded).toBe(true);
    expect(outcome.result.message).toBe("no_sources_configured");
    expect(outcome.sourceId).toBe("none");
  });

  it("keeps going when a source throws instead of aborting the chain", async () => {
    const outcome = await searchWithFailover(
      [throwing("broken", new Error("boom")), stub("ignav", ok("ignav"))],
      params,
    );

    expect(outcome.sourceId).toBe("ignav");
    expect(outcome.attempts[0]).toEqual({
      sourceId: "broken",
      degraded: true,
      message: "threw:boom",
    });
  });
});

describe("resolveChain", () => {
  it("defaults to mock only", () => {
    const { sources, skipped } = resolveChain({});

    expect(sources.map((s) => s.id)).toEqual(["mock"]);
    expect(skipped).toEqual([]);
  });

  it("keeps the configured order as the failover order", () => {
    const { sources } = resolveChain({
      FLIGHT_SOURCES: "serpapi,ignav",
      SERPAPI_API_KEY: "a",
      IGNAV_API_KEY: "b",
    });

    expect(sources.map((s) => s.id)).toEqual(["serpapi", "ignav"]);
  });

  it("drops mock when a real source is present", () => {
    const { sources } = resolveChain({
      FLIGHT_SOURCES: "mock,ignav",
      IGNAV_API_KEY: "b",
    });

    expect(sources.map((s) => s.id)).toEqual(["ignav"]);
  });

  it("skips a source whose api key is missing", () => {
    const { sources, skipped } = resolveChain({ FLIGHT_SOURCES: "serpapi,ignav" });

    expect(sources.map((s) => s.id)).toEqual([]);
    expect(skipped).toEqual([
      "serpapi:missing_api_key",
      "ignav:missing_api_key",
    ]);
  });

  it("skips an unknown source name", () => {
    const { sources, skipped } = resolveChain({ FLIGHT_SOURCES: "amadeus" });

    expect(sources).toEqual([]);
    expect(skipped).toEqual(["amadeus:unknown_source"]);
  });

  it("trims and lowercases the configured list", () => {
    const { sources } = resolveChain({
      FLIGHT_SOURCES: " SerpAPI , IGNAV ",
      SERPAPI_API_KEY: "a",
      IGNAV_API_KEY: "b",
    });

    expect(sources.map((s) => s.id)).toEqual(["serpapi", "ignav"]);
  });
});
