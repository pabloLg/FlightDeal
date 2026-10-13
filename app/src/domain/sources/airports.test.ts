import { describe, expect, it } from "vitest";

import { airportCity, airportName, cityMapFor } from "./airports";

describe("airports", () => {
  it("resolves a known IATA code to its city", () => {
    expect(airportCity("MAD")).toBe("Madrid");
    expect(airportCity("BCN")).toBe("Barcelona");
  });

  it("is case-insensitive and trims", () => {
    expect(airportCity(" mad ")).toBe("Madrid");
  });

  it("returns null for unknown or empty codes", () => {
    expect(airportCity("ZZZ")).toBeNull();
    expect(airportCity("")).toBeNull();
    expect(airportCity(null)).toBeNull();
    expect(airportName("ZZZ")).toBeNull();
  });

  it("builds a code -> city map skipping unknown codes", () => {
    expect(cityMapFor(["MAD", "ZZZ", "bcn"])).toEqual({
      MAD: "Madrid",
      BCN: "Barcelona",
    });
  });
});
