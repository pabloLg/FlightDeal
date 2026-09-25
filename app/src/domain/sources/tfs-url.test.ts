import { describe, expect, it } from "vitest";

import { buildTfsUrl } from "./tfs-url";
import type { FlightSearchParams } from "./types";

function tfsOf(url: string): string {
  return new URL(url).searchParams.get("tfs") ?? "";
}

const base: FlightSearchParams = {
  origin: "MAD",
  destination: "NYC",
  departDate: "2026-12-01",
  returnDate: "2026-12-15",
  tripType: "round_trip",
  cabinClass: "economy",
  stops: "any",
  adults: 1,
  currency: "EUR",
};

describe("buildTfsUrl", () => {
  it("produces a deterministic URL with the frozen query flags", () => {
    const url = buildTfsUrl(base);
    expect(buildTfsUrl(base)).toBe(url);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://www.google.com/travel/flights/search",
    );
    expect(parsed.searchParams.get("hl")).toBe("es");
    expect(parsed.searchParams.get("gl")).toBe("ES");
    expect(parsed.searchParams.get("curr")).toBe("EUR");
  });

  it("starts with the documented protobuf prefix (query_mode=28, query_context=2)", () => {
    // 08 1c 10 02 base64-encodes to the "CBwQAh" prefix of known-good URLs
    expect(tfsOf(buildTfsUrl(base)).startsWith("CBwQAh")).toBe(true);
  });

  it("encodes both legs for round trips and one leg for one-way", () => {
    const round = tfsOf(buildTfsUrl(base));
    const oneWay = tfsOf(
      buildTfsUrl({ ...base, tripType: "one_way", returnDate: undefined }),
    );
    expect(round.length).toBeGreaterThan(oneWay.length);
    expect(round).not.toBe(oneWay);
    expect(tfsOf(buildTfsUrl({ ...base, tripType: "one_way", returnDate: undefined }))).toBe(oneWay);
  });

  it("differs by date, route, cabin, stops and passengers", () => {
    const variants = [
      { ...base, departDate: "2026-12-02" },
      { ...base, destination: "LON" },
      { ...base, cabinClass: "business" as const },
      { ...base, stops: "non_stop" as const },
      { ...base, adults: 2 },
    ];
    const seen = new Set([tfsOf(buildTfsUrl(base))]);
    for (const v of variants) {
      const tfs = tfsOf(buildTfsUrl(v));
      expect(seen.has(tfs)).toBe(false);
      seen.add(tfs);
    }
  });

  it("uses URL-safe base64 without padding", () => {
    expect(tfsOf(buildTfsUrl(base))).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});