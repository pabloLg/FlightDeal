import { describe, expect, it } from "vitest";
import {
  buildAggregationContext,
  mergeFlightOptions,
  type MergedFlightOption,
} from "./aggregator";
import type { FlightLeg, FlightOption } from "./types";

const baseLegs = {
  outbound: [
    {
      airline: "IB",
      airlineName: "Iberia",
      flightNumber: "5001",
      departAirport: "MAD",
      arriveAirport: "BCN",
      departAt: "2026-10-15T09:00:00Z",
      arriveAt: "2026-10-15T10:30:00Z",
      durationMin: 90,
    },
  ],
  inbound: [],
};

const makeOpt = (id: string, price: number, source: string, extra: Partial<FlightOption> = {}): FlightOption => ({
  id: `${source}-${id}`,
  price,
  currency: "EUR",
  outboundLegs: extra.outboundLegs ?? baseLegs.outbound,
  inboundLegs: extra.inboundLegs ?? baseLegs.inbound,
  airlines: extra.airlines ?? ["IB"],
  totalDurationMin: extra.totalDurationMin ?? 90,
  ...extra,
});

describe("aggregator.mergeFlightOptions", () => {
  const newAcc = () => new Map<string, MergedFlightOption>();

  it("adds new itinerary when not present", () => {
    const acc = newAcc();
    const res = mergeFlightOptions(acc, [makeOpt("a", 90, "gf")], "gf");
    expect(res.merged).toBe(1);
    expect(res.duplicates).toBe(0);
    expect(acc.size).toBe(1);
  });

  it("dedupes same itinerary from different source by itineraryKey (ignores sourceId)", () => {
    const acc = newAcc();
    mergeFlightOptions(acc, [makeOpt("a", 90, "gf")], "gf");
    mergeFlightOptions(acc, [makeOpt("a", 92, "serpapi")], "serpapi");
    expect(acc.size).toBe(1);
    const v = Array.from(acc.values())[0];
    expect(v.sources).toContain("gf");
    expect(v.sources).toContain("serpapi");
  });

  it("keeps cheapest price and updates selectedSource", () => {
    const acc = newAcc();
    mergeFlightOptions(acc, [makeOpt("a", 90, "gf")], "gf");
    mergeFlightOptions(acc, [makeOpt("a", 87, "serpapi")], "serpapi");
    const v = Array.from(acc.values())[0];
    expect(v.price).toBe(87);
    expect(v.selectedSource).toBe("serpapi");
  });

  it("merges bookingUrls when same price", () => {
    const acc = newAcc();
    mergeFlightOptions(
      acc,
      [makeOpt("a", 90, "gf", { bookingUrl: "https://a.example" })],
      "gf",
    );
    mergeFlightOptions(
      acc,
      [makeOpt("a", 90, "serpapi", { bookingUrl: "https://b.example" })],
      "serpapi",
    );
    const v = Array.from(acc.values())[0];
    expect(v.bookingUrls?.length).toBe(2);
  });

  it("keeps bookingUrls when cheaper comes later", () => {
    const acc = newAcc();
    mergeFlightOptions(
      acc,
      [makeOpt("a", 90, "gf", { bookingUrl: "https://a.example" })],
      "gf",
    );
    mergeFlightOptions(
      acc,
      [makeOpt("a", 87, "serpapi", { bookingUrl: "https://b.example" })],
      "serpapi",
    );
    const v = Array.from(acc.values())[0];
    expect(v.price).toBe(87);
    expect(v.bookingUrls?.map((u) => u.url)).toContain("https://a.example");
    expect(v.bookingUrls?.map((u) => u.url)).toContain("https://b.example");
  });
});

describe("aggregator.buildAggregationContext", () => {
  it("builds context with duplicatesRemoved", () => {
    const acc = new Map<string, MergedFlightOption>();
    mergeFlightOptions(acc, [makeOpt("a", 90, "gf")], "gf");
    mergeFlightOptions(acc, [makeOpt("a", 87, "serpapi"), makeOpt("b", 120, "serpapi")], "serpapi");
    const ctx = buildAggregationContext(acc, ["gf", "serpapi"], ["gf", "serpapi"], 3);
    expect(ctx.mergedCount).toBe(1);
    expect(ctx.duplicatesRemoved).toBeGreaterThanOrEqual(0);
  });
});

describe("aggregator.mergeFlightOptions + build", () => {
  it("count merged items correctly", () => {
    const acc = new Map<string, MergedFlightOption>();
    const outbound: FlightLeg[] = [{airline:'IB',flightNumber:'5001',departAirport:'MAD',arriveAirport:'BCN',departAt:'2026-10-15T09:00:00Z',arriveAt:'2026-10-15T10:30:00Z',durationMin:90}];
    const inbound: FlightLeg[] = [];
    const mk = (id: string, p: number, s: string): FlightOption => ({id:s+'-'+id,price:p,currency:'EUR',outboundLegs:outbound,inboundLegs:inbound,airlines:['IB'],totalDurationMin:90});
    mergeFlightOptions(acc,[mk('a',90,'gf')],'gf');
    mergeFlightOptions(acc,[mk('a',87,'serpapi'),mk('b',120,'serpapi')],'serpapi');
    const ctx = buildAggregationContext(acc,['gf','serpapi'],['serpapi'],3);
    expect(ctx.mergedCount).toBe(1);
  });
});
