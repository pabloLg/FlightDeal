import { describe, expect, it } from "vitest";

import {
  buildTrends,
  filterRoutes,
  periodFrom,
  pickDashboardRoutes,
  routeKeyOf,
  shiftIsoDate,
  sortRoutes,
  summarize,
  type SearchLike,
  type StatLike,
} from "./summary";

const TODAY = "2026-10-13";

function search(over: Partial<SearchLike> & { id: string }): SearchLike {
  return {
    origin: "MAD",
    destination: "BCN",
    depart_date: "2026-11-01",
    return_date: "2026-11-08",
    trip_type: "round_trip",
    date_flex_days: 0,
    ...over,
  };
}

function stat(search_id: string, stats_date: string, min: number | null): StatLike {
  return { search_id, stats_date, min_price_eur: min };
}

const keyOf = (over: Partial<SearchLike> & { id: string }): string =>
  routeKeyOf(search(over));

describe("shiftIsoDate / periodFrom", () => {
  it("crosses month and year boundaries", () => {
    expect(shiftIsoDate("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftIsoDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("makes 7 days today + the 6 before it, 30 = today + 29", () => {
    expect(periodFrom("7", TODAY)).toBe("2026-10-07");
    expect(periodFrom("30", TODAY)).toBe("2026-09-14");
    expect(periodFrom("all", TODAY)).toBeNull();
  });
});

describe("routeKeyOf", () => {
  it("ignores dates, keeps origin, destination and trip type", () => {
    expect(routeKeyOf(search({ id: "s1" }))).toBe("MAD|BCN|round_trip");
    expect(
      routeKeyOf(search({ id: "s2", depart_date: "2026-12-01" })),
    ).toBe("MAD|BCN|round_trip");
    expect(
      routeKeyOf(search({ id: "s3", trip_type: "one_way", return_date: null })),
    ).toBe("MAD|BCN|one_way");
  });
});

describe("buildTrends", () => {
  const s = search({ id: "s1" });

  it("keeps only the period and never the future", () => {
    const routes = buildTrends(
      [s],
      [
        stat("s1", "2026-10-07", 100),
        stat("s1", "2026-10-06", 90), // 1 day before the 7-day window
        stat("s1", "2026-10-14", 80), // tomorrow
      ],
      {},
      { period: "7", today: TODAY },
    );
    expect(routes).toHaveLength(1);
    expect(routes[0].days.map((d) => d.date)).toEqual(["2026-10-07"]);
  });

  it("computes the change from first to last observed daily minimum", () => {
    const [route] = buildTrends(
      [s],
      [stat("s1", "2026-10-08", 200), stat("s1", "2026-10-12", 150)],
      { s1: "2026-10-12T06:03:00Z" },
      { period: "7", today: TODAY },
    );
    expect(route.minPeriod).toBe(150);
    expect(route.firstMin).toBe(200);
    expect(route.lastMin).toBe(150);
    expect(route.change).toBeCloseTo(-25);
    expect(route.lastCheckAt).toBe("2026-10-12T06:03:00Z");
  });

  it("leaves change null with fewer than two observed days", () => {
    const [route] = buildTrends(
      [s],
      [stat("s1", "2026-10-12", 150)],
      {},
      { period: "7", today: TODAY },
    );
    expect(route.change).toBeNull();
  });

  it("fuses every search of the same route into one combined line", () => {
    const s1 = search({ id: "s1", depart_date: "2026-11-01" });
    const s2 = search({ id: "s2", depart_date: "2026-12-01" });
    const routes = buildTrends(
      [s1, s2],
      [
        stat("s1", "2026-10-08", 200),
        stat("s2", "2026-10-10", 150),
        stat("s1", "2026-10-12", 180),
      ],
      {},
      { period: "7", today: TODAY },
    );
    expect(routes).toHaveLength(1);
    const [route] = routes;
    expect(route.key).toBe("MAD|BCN|round_trip");
    expect(route.searches.map((m) => m.id)).toEqual(["s1", "s2"]);
    expect(route.departDates).toEqual(["2026-11-01", "2026-12-01"]);
    expect(route.days).toEqual([
      { date: "2026-10-08", min: 200 },
      { date: "2026-10-10", min: 150 },
      { date: "2026-10-12", min: 180 },
    ]);
    expect(route.change).toBeCloseTo(-10);
  });

  it("keeps the cheapest observation of the route on the same day", () => {
    const [route] = buildTrends(
      [search({ id: "s1" }), search({ id: "s2" })],
      [stat("s1", "2026-10-12", 150), stat("s2", "2026-10-12", 120)],
      {},
      { period: "7", today: TODAY },
    );
    expect(route.days).toEqual([{ date: "2026-10-12", min: 120 }]);
  });

  it("links to the search with the latest observation and reports the latest check", () => {
    const [route] = buildTrends(
      [search({ id: "s1" }), search({ id: "s2" })],
      [stat("s1", "2026-10-08", 200), stat("s2", "2026-10-12", 150)],
      { s1: "2026-10-08T05:00:00Z", s2: "2026-10-12T06:03:00Z" },
      { period: "7", today: TODAY },
    );
    expect(route.latestSearchId).toBe("s2");
    expect(route.lastCheckAt).toBe("2026-10-12T06:03:00Z");
  });

  it("ignores null prices and keeps one-way apart from round-trip", () => {
    const ow = search({ id: "s2", trip_type: "one_way", return_date: null });
    const routes = buildTrends(
      [s, ow],
      [
        stat("s1", "2026-10-12", 150),
        stat("s1", "2026-10-13", null),
        stat("s2", "2026-10-12", 90),
      ],
      {},
      { period: "7", today: TODAY },
    );
    expect(routes).toHaveLength(2);
    expect(routes.find((r) => r.tripType === "round_trip")!.days).toHaveLength(1);
    expect(routes.find((r) => r.tripType === "one_way")!.tripType).toBe("one_way");
  });

  it("drops stats whose search is not in the list", () => {
    const routes = buildTrends(
      [s],
      [stat("s1", "2026-10-12", 150), stat("ghost", "2026-10-12", 10)],
      {},
      { period: "7", today: TODAY },
    );
    expect(routes).toHaveLength(1);
    expect(routes[0].days).toEqual([{ date: "2026-10-12", min: 150 }]);
  });

  it("covers the whole history in the 'all' period", () => {
    const [route] = buildTrends(
      [s],
      [stat("s1", "2025-01-02", 300), stat("s1", "2026-10-12", 150)],
      {},
      { period: "all", today: TODAY },
    );
    expect(route.days).toHaveLength(2);
    expect(route.change).toBeCloseTo(-50);
  });
});

describe("summarize", () => {
  it("counts fused routes, not searches", () => {
    const routes = buildTrends(
      [search({ id: "a" }), search({ id: "a2" }), search({ id: "b", destination: "LIS" })],
      [
        stat("a", "2026-10-08", 200),
        stat("a2", "2026-10-09", 180),
        stat("a", "2026-10-12", 150),
        stat("b", "2026-10-12", 400),
      ],
      {},
      { period: "7", today: TODAY },
    );
    expect(summarize(routes)).toEqual({ routeCount: 2, minPrice: 150, dropCount: 1 });
  });

  it("is empty-safe", () => {
    expect(summarize([])).toEqual({ routeCount: 0, minPrice: null, dropCount: 0 });
  });
});

describe("filterRoutes / sortRoutes", () => {
  const kA = keyOf({ id: "a" });
  const kB = keyOf({ id: "b", destination: "LIS" });
  const kC = keyOf({ id: "c", origin: "BER", destination: "BCN" });
  const routes = buildTrends(
    [
      search({ id: "a" }),
      search({ id: "b", destination: "LIS" }),
      search({ id: "c", origin: "BER", destination: "BCN" }),
    ],
    [
      stat("a", "2026-10-08", 200),
      stat("a", "2026-10-12", 150),
      stat("b", "2026-10-12", 90),
      stat("c", "2026-10-09", 60),
      stat("c", "2026-10-10", 80),
    ],
    {},
    { period: "7", today: TODAY },
  );

  it("filters by origin and destination", () => {
    expect(
      filterRoutes(routes, { origin: "", destination: "BCN" }).map((r) => r.key),
    ).toEqual([kA, kC]);
    expect(
      filterRoutes(routes, { origin: "MAD", destination: "" }).map((r) => r.key),
    ).toEqual([kA, kB]);
  });

  it("sorts by min, drop (nulls last) and recency", () => {
    expect(sortRoutes(routes, "min").map((r) => r.key)).toEqual([kC, kB, kA]);
    // c = +33%, a = -25%, b has no change -> last.
    expect(sortRoutes(routes, "drop").map((r) => r.key)).toEqual([kA, kC, kB]);
    expect(sortRoutes(routes, "recent").map((r) => r.key)).toEqual([kA, kB, kC]);
  });
});

describe("pickDashboardRoutes", () => {
  it("prefers recent routes and, among them, the ones with a demonstrated drop", () => {
    const kDrop = keyOf({ id: "recent-drop" });
    const kFlat = keyOf({ id: "recent-flat", destination: "LIS" });
    const kOld = keyOf({ id: "old", origin: "BER" });
    const routes = buildTrends(
      [
        search({ id: "recent-drop" }),
        search({ id: "recent-flat", destination: "LIS" }),
        search({ id: "old", origin: "BER" }),
      ],
      [
        stat("recent-drop", "2026-10-08", 300),
        stat("recent-drop", "2026-10-12", 200),
        stat("recent-flat", "2026-10-12", 400),
        stat("old", "2026-09-01", 100),
        stat("old", "2026-09-02", 90),
      ],
      {},
      { period: "all", today: TODAY },
    );
    expect(pickDashboardRoutes(routes, TODAY).map((r) => r.key)).toEqual([
      kDrop,
      kFlat,
      kOld,
    ]);
  });

  it("falls back to the most recent routes when nothing dropped", () => {
    const kA = keyOf({ id: "a" });
    const kB = keyOf({ id: "b", destination: "LIS" });
    const routes = buildTrends(
      [search({ id: "a" }), search({ id: "b", destination: "LIS" })],
      [stat("a", "2026-10-10", 100), stat("b", "2026-10-12", 200)],
      {},
      { period: "7", today: TODAY },
    );
    expect(pickDashboardRoutes(routes, TODAY).map((r) => r.key)).toEqual([kB, kA]);
  });

  it("caps the list at the limit", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const dates = ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"];
    const routes = buildTrends(
      ids.map((id, i) => search({ id, destination: `D${i}` })),
      ids.map((id, i) => stat(id, dates[i], 100 + i)),
      {},
      { period: "7", today: TODAY },
    );
    expect(pickDashboardRoutes(routes, TODAY)).toHaveLength(3);
  });
});
