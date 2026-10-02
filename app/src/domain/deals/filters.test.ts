import { describe, expect, it } from "vitest";

import {
  airlineOptions,
  applyFilters,
  DEFAULT_FILTERS,
  parseFilters,
  type FlightOptionRow,
} from "./filters";

function row(
  price: number,
  legs: number,
  duration: number | null = 600,
  airline = "UX",
): FlightOptionRow {
  return {
    id: `${price}-${legs}`,
    price_eur: price,
    currency: "EUR",
    outbound_legs: Array.from({ length: legs }, (_, i) => ({
      airline,
      airlineName: airline === "UX" ? "Air Europa" : "Iberia",
      flightNumber: `${i}`,
      departAirport: "MAD",
      arriveAirport: "BCN",
      departAt: "2026-10-01T08:00:00",
      arriveAt: "2026-10-01T09:00:00",
      durationMin: 60,
    })),
    inbound_legs: [],
    airlines: [airline],
    total_duration_min: duration,
  };
}

const rows = [row(120, 1), row(90, 3, 900), row(200, 1)];

describe("parseFilters", () => {
  it("ignores junk and falls back to the defaults", () => {
    expect(parseFilters({})).toEqual(DEFAULT_FILTERS);
    expect(parseFilters({ precio: "abc", dur: "-5", ord: "sql" })).toEqual(
      DEFAULT_FILTERS,
    );
    expect(parseFilters({ precio: "abc", directo: "1" })).toEqual({
      ...DEFAULT_FILTERS,
      nonStopOnly: true,
    });
  });

  it("reads numbers and the sort whitelist", () => {
    expect(parseFilters({ precio: "150", dur: "800", ord: "stops" })).toEqual({
      maxPrice: 150,
      maxDuration: 800,
      nonStopOnly: false,
      airline: null,
      sort: "stops",
    });
  });
});

describe("applyFilters", () => {
  it("drops rows over the caps and always sorts cheapest first by default", () => {
    expect(applyFilters(rows, DEFAULT_FILTERS).map((r) => r.price_eur)).toEqual([
      90, 120, 200,
    ]);
    expect(
      applyFilters(rows, { ...DEFAULT_FILTERS, maxPrice: 150 }).map(
        (r) => r.price_eur,
      ),
    ).toEqual([90, 120]);
    expect(
      applyFilters(rows, { ...DEFAULT_FILTERS, nonStopOnly: true }).map(
        (r) => r.price_eur,
      ),
    ).toEqual([120, 200]);
    expect(
      applyFilters(rows, { ...DEFAULT_FILTERS, maxDuration: 600 }).map(
        (r) => r.price_eur,
      ),
    ).toEqual([120, 200]);
  });

  it("sorts by stops and duration without dropping the price tiebreak", () => {
    expect(
      applyFilters(rows, { ...DEFAULT_FILTERS, sort: "stops" }).map(
        (r) => r.price_eur,
      ),
    ).toEqual([120, 200, 90]);
    expect(
      applyFilters(rows, { ...DEFAULT_FILTERS, sort: "duration" }).map(
        (r) => r.price_eur,
      ),
    ).toEqual([120, 200, 90]);
  });

  it("filters by airline code or pretty name and lists the options once", () => {
    const mixed = [...rows, row(70, 1, 600, "IB")];
    expect(airlineOptions(mixed)).toEqual(["Air Europa", "Iberia"]);
    expect(
      applyFilters(mixed, { ...DEFAULT_FILTERS, airline: "Iberia" }).map(
        (r) => r.price_eur,
      ),
    ).toEqual([70]);
    expect(
      applyFilters(mixed, { ...DEFAULT_FILTERS, airline: "UX" }).map(
        (r) => r.price_eur,
      ),
    ).toEqual([90, 120, 200]);
  });
});