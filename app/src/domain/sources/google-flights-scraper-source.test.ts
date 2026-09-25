import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { GoogleFlightsScraperSource } from "./google-flights-scraper-source";
import { structureGuard } from "./structure-guard";
import { parsePage, normalize } from "./parse-page";
import { buildTfsUrl } from "./tfs-url";

const fixturePath = path.join(__dirname, "fixtures", "mad-bcn-roundtrip.html");
const noResultsFixturePath = path.join(__dirname, "fixtures", "aa-bcn-no-results.html");

const params = {
  origin: "MAD",
  destination: "BCN",
  departDate: "2026-10-01",
  tripType: "round_trip" as const,
  cabinClass: "economy" as const,
  stops: "any" as const,
  adults: 1,
  currency: "EUR",
};

function readFixture(): string {
  return fs.readFileSync(fixturePath, "utf8").replace(/^\uFEFF/, "");
}

function readNoResultsFixture(): string {
  return fs
    .readFileSync(noResultsFixturePath, "utf8")
    .replace(/^\uFEFF/, "");
}

describe("parsePage", () => {
  it("extracts all 17 options from the real fixture", () => {
    const raw = parsePage(readFixture());
    expect(raw).toHaveLength(17);
  });

  it("keeps flight numbers, airports and timestamps per leg", () => {
    const raw = parsePage(readFixture());
    expect(raw[0]).toMatchObject({
      airline: "UX",
      price: 103,
      totalDurationMin: 85,
    });
    expect(raw[0].outboundLegs[0]).toMatchObject({
      airline: "UX",
      flightNumber: "7701",
      departAirport: "MAD",
      arriveAirport: "BCN",
      departAt: "2026-10-01T07:30:00",
      arriveAt: "2026-10-01T08:55:00",
      durationMin: 85,
    });
  });

  it("handles multi-leg options (connections)", () => {
    const raw = parsePage(readFixture());
    const multi = raw[8];
    expect(multi.outboundLegs).toHaveLength(2);
    expect(multi.airline).toBe("LH");
    expect(multi.price).toBe(268);
  });

  it("round-trips currency via normalize", () => {
    const flightOptions = normalize(parsePage(readFixture()), params);
    expect(flightOptions).toHaveLength(17);
    expect(flightOptions[0].currency).toBe("EUR");
    expect(flightOptions[0].inboundLegs).toEqual([]);
  });
});

describe("structureGuard", () => {
  it("passes on the real fixture", () => {
    expect(structureGuard(readFixture()).ok).toBe(true);
  });

  it("passes on a real no-results page (legitimate empty result)", () => {
    const result = structureGuard(readNoResultsFixture());
    expect(result.ok).toBe(true);
  });

  it("fails closed on a page without the title marker", () => {
    const html = readFixture();
    const broken = html.replace("Google Vuelos", "ERROR PAGE");
    const result = structureGuard(broken);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("missing_marker");
  });

  it("fails closed when the ds:1 callback is missing", () => {
    const html = readFixture();
    const cut = html.slice(0, html.indexOf("AF_initDataCallback({key: 'ds:1'"));
    const result = structureGuard(cut);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("missing_marker");
  });

  it("fails closed when the ds:1 payload is corrupt (truncated JSON)", () => {
    // Same shell, but ds:1 body cut mid-array: structure present, data not JSON.
    const good = readFixture();
    const marker = "AF_initDataCallback({key: 'ds:1'";
    const start = good.indexOf(marker);
    const truncated = good.slice(0, start + marker.length + 40) + "</script></body></html>";
    const result = structureGuard(truncated);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("parse_failed:ds1_missing_or_corrupt");
  });
});

describe("GoogleFlightsScraperSource", () => {
  it("returns options from the fixture fetcher", async () => {
    const source = new GoogleFlightsScraperSource(() =>
      Promise.resolve(readFixture()),
    );
    const result = await source.search(params);
    expect(result.options).toHaveLength(17);
    expect(result.degraded).toBe(false);
    expect(result.structureVersion).toBe(1);
  });

  it("degrades (fail-closed) when the fetcher throws", async () => {
    const source = new GoogleFlightsScraperSource(() =>
      Promise.reject(new Error("boom")),
    );
    const result = await source.search(params);
    expect(result.options).toHaveLength(0);
    expect(result.degraded).toBe(true);
    expect(result.message).toContain("fetch_failed");
  });

  it("degrades (fail-closed) on an unexpected structure", async () => {
    const source = new GoogleFlightsScraperSource(() =>
      Promise.resolve("<html><title>Something else</title></html>"),
    );
    const result = await source.search(params);
    expect(result.options).toHaveLength(0);
    expect(result.degraded).toBe(true);
    expect(result.message).toContain("structure_mismatch");
  });

  it("returns a valid empty no_flights result on a legit no-results page", async () => {
    const source = new GoogleFlightsScraperSource(() =>
      Promise.resolve(readNoResultsFixture()),
    );
    const result = await source.search(params);
    expect(result.options).toHaveLength(0);
    expect(result.degraded).toBe(false);
    expect(result.message).toBe("no_flights");
  });
});

describe("buildTfsUrl (regression)", () => {
  it("builds the known-good URL for the fixture route", () => {
    const url = buildTfsUrl(params);
    expect(url.startsWith("https://www.google.com/travel/flights/search?tfs=")).toBe(true);
    expect(url).toContain("hl=es");
    expect(url).toContain("gl=ES");
    expect(url).toContain("curr=EUR");
  });
});