import { describe, expect, it } from "vitest";
import { searchWithSequentialMerge } from "./chain-merge";
import type { FlightSource } from "./flight-source";
import type { FlightSearchParams, FlightSourceResult, HealthStatus } from "./types";

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

const opt = (id: string, price: number) => ({
  id: `${id}-option`,
  price,
  currency: "EUR",
  outboundLegs: [],
  inboundLegs: [],
  airlines: [],
  totalDurationMin: 90,
});

const ok = (id: string, price = 50): FlightSourceResult => ({
  options: [opt(id, price)],
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

const noFlights = (): FlightSourceResult => ({
  options: [],
  currency: "EUR",
  structureVersion: 1,
  degraded: false,
  message: "no_flights",
});

class StubSource implements FlightSource {
  readonly id: string;
  readonly calls: string[] = [];
  private readonly behaviour: () => Promise<FlightSourceResult>;

  constructor(id: string, behaviour: () => Promise<FlightSourceResult>) {
    this.id = id;
    this.behaviour = behaviour;
  }

  async search(): Promise<FlightSourceResult> {
    this.calls.push(this.id);
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

describe("searchWithSequentialMerge", () => {
  it("concatenates options from every source with per-option sources", async () => {
    const out = await searchWithSequentialMerge(
      [stub("gf", ok("gf", 90)), stub("serpapi", ok("serpapi", 87))],
      params,
      5000,
      {},
    );

    expect(out.result.degraded).toBe(false);
    expect(out.result.options.map((o) => o.price)).toEqual([90, 87]);
    expect(out.optionSources).toEqual(["gf", "serpapi"]);
    expect(out.aggregation).toMatchObject({
      sourcesAttempted: ["gf", "serpapi"],
      sourcesIncluded: ["gf", "serpapi"],
      optionCount: 2,
      bestPrice: 87,
      bestSource: "serpapi",
    });
    // Same itinerary from two sources stays two rows (tarjeta por fuente).
    expect(out.result.options[0].id).not.toBe(out.result.options[1].id);
  });

  it("stops on a verified-empty result without asking the next source", async () => {
    const first = stub("gf", noFlights());
    const second = stub("serpapi", ok("serpapi", 87));
    const out = await searchWithSequentialMerge([first, second], params, 5000, {});

    expect(second.calls).toHaveLength(0);
    expect(out.result.degraded).toBe(false);
    expect(out.result.options).toEqual([]);
    expect(out.result.message).toBe("no_flights");
    expect(out.attempts[0]).toMatchObject({
      sourceId: "gf",
      degraded: false,
      included: false,
      reason: "no_flights",
    });
  });

  it("keeps rows already collected when a later source is empty", async () => {
    const out = await searchWithSequentialMerge(
      [stub("gf", ok("gf", 90)), stub("serpapi", noFlights())],
      params,
      5000,
      {},
    );

    expect(out.result.degraded).toBe(false);
    expect(out.result.options.map((o) => o.price)).toEqual([90]);
    expect(out.aggregation.bestSource).toBe("gf");
  });

  it("skips degraded sources and keeps going", async () => {
    const out = await searchWithSequentialMerge(
      [stub("serpapi", degraded("http_429")), stub("ignav", ok("ignav", 60))],
      params,
      5000,
      {},
    );

    expect(out.sourceId).toBe("ignav");
    expect(out.result.options.map((o) => o.price)).toEqual([60]);
    expect(out.attempts[0]).toMatchObject({
      sourceId: "serpapi",
      degraded: true,
      included: false,
    });
  });

  it("treats a throwing source as degraded instead of aborting", async () => {
    const out = await searchWithSequentialMerge(
      [throwing("broken", new Error("boom")), stub("ignav", ok("ignav", 60))],
      params,
      5000,
      {},
    );

    expect(out.sourceId).toBe("ignav");
    expect(out.attempts[0]).toMatchObject({
      sourceId: "broken",
      degraded: true,
      message: "threw:boom",
    });
  });

  it("reports every source degraded when none is usable", async () => {
    const out = await searchWithSequentialMerge(
      [stub("serpapi", degraded("http_429")), stub("ignav", degraded("http_402"))],
      params,
      5000,
      {},
    );

    expect(out.result.degraded).toBe(true);
    expect(out.result.message).toBe("http_402");
    expect(out.result.options).toEqual([]);
  });

  it("treats an empty chain as degraded instead of succeeding empty", async () => {
    const out = await searchWithSequentialMerge([], params, 5000, {});

    expect(out.result.degraded).toBe(true);
    expect(out.result.message).toBe("no_sources_configured");
    expect(out.sourceId).toBe("none");
  });

  it("does not start a source when the remaining budget is below the margin", async () => {
    const first = stub("gf", ok("gf", 90));
    const out = await searchWithSequentialMerge([first], params, 5000, {
      FLIGHT_SOURCE_TIMEOUT_MARGIN_MS: String(Number.MAX_SAFE_INTEGER),
    });

    expect(first.calls).toHaveLength(0);
    expect(out.attempts[0]).toMatchObject({
      sourceId: "gf",
      included: false,
      reason: "timeout_margin_exceeded",
    });
  });

  it("asks no further source once the budget is spent", async () => {
    const hungry: FlightSource = {
      id: "hungry",
      async search() {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { ...ok("hungry"), degraded: true, message: "took_too_long" };
      },
      async health() {
        return { ok: true };
      },
    };
    const second = stub("serpapi", ok("serpapi", 87));

    const out = await searchWithSequentialMerge([hungry, second], params, 20, {
      FLIGHT_SOURCE_TIMEOUT_MARGIN_MS: "0",
    });

    expect(second.calls).toHaveLength(0);
    expect(out.attempts[1]).toMatchObject({
      sourceId: "serpapi",
      included: false,
      reason: "budget_exhausted:chain",
    });
  });

  it("caps sources at MAX_SOURCES_PER_RUN", async () => {
    const third = stub("ignav", ok("ignav", 70));
    const out = await searchWithSequentialMerge(
      [stub("gf", ok("gf", 90)), stub("serpapi", ok("serpapi", 87)), third],
      params,
      5000,
      { FLIGHT_MAX_SOURCES_PER_RUN: "2" },
    );

    expect(third.calls).toHaveLength(0);
    expect(out.attempts[2]).toMatchObject({
      sourceId: "ignav",
      included: false,
      reason: "max_sources_per_run_reached",
    });
    expect(out.aggregation.maxSourcesPerRun).toBe(2);
  });

  it("carries returnLegs traceability per source", async () => {
    const withLegs = {
      ...ok("sa", 87),
      returnLegs: "attached",
    } as unknown as FlightSourceResult;
    const out = await searchWithSequentialMerge([stub("sa", withLegs)], params, 5000, {});

    expect(out.returnLegsBySource).toEqual({ sa: "attached" });
  });
});
