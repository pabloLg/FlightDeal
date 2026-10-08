import { describe, expect, it } from "vitest";

import { resolveChain } from "./chain";

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
