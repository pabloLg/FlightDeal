import { describe, expect, it } from "vitest";

import { directionSummary } from "./flight-summary";
import type { FlightLegLike } from "./filters";

const leg = (
  departAirport: string,
  arriveAirport: string,
  durationMin: number,
  departAt = "2026-10-01T08:00:00",
  arriveAt = "2026-10-01T09:00:00",
): FlightLegLike => ({
  airline: "IB",
  flightNumber: "IB0001",
  departAirport,
  arriveAirport,
  departAt,
  arriveAt,
  durationMin,
});

describe("directionSummary", () => {
  it("returns null for no legs", () => {
    expect(directionSummary([])).toBeNull();
    expect(directionSummary(null)).toBeNull();
  });

  it("uses the first departure and the last arrival of a direct flight", () => {
    const s = directionSummary([leg("MAD", "BCN", 75)]);
    expect(s).toMatchObject({
      departAirport: "MAD",
      arriveAirport: "BCN",
      stops: 0,
      durationMin: 75,
    });
  });

  it("sums segment durations and counts stops on a connection", () => {
    const s = directionSummary([
      leg("MAD", "LIS", 60),
      leg("LIS", "BCN", 90, "2026-10-01T11:00:00", "2026-10-01T12:30:00"),
    ]);
    expect(s).toMatchObject({ departAirport: "MAD", arriveAirport: "BCN", stops: 1, durationMin: 150 });
  });
});
