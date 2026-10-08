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

const ok = (id: string, price = 50): FlightSourceResult => ({
  options: [
    {
      id: `${id}-option`,
      price,
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

describe("searchWithSequentialMerge", () => {
  it("merges results from multiple sources", async () => {
    const out = await searchWithSequentialMerge(
      [stub("gf", ok("gf", 90)), stub("serpapi", ok("serpapi", 87))],
      params,
      5000,
      {},
    );
    expect(out.result.degraded).toBe(false);
    expect(out.result.options.length).toBeGreaterThanOrEqual(1);
  });
});
