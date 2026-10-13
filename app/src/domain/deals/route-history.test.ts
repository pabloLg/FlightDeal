import { describe, expect, it } from "vitest";

import { combineDailyStats, routineAverage, type RouteStatRow } from "./route-history";

const row = (
  stats_date: string,
  min: number | null,
  max: number | null,
  avg: number | null,
  observations = 1,
): RouteStatRow => ({
  stats_date,
  min_price_eur: min,
  max_price_eur: max,
  avg_price_eur: avg,
  observations,
});

describe("combineDailyStats", () => {
  it("returns a single search's rows unchanged, sorted ascending", () => {
    const days = combineDailyStats([
      row("2026-10-02", 55, 60, 58, 3),
      row("2026-10-01", 80, 90, 85, 2),
    ]);
    expect(days).toEqual([
      { date: "2026-10-01", min: 80, max: 90, avg: 85, observations: 2 },
      { date: "2026-10-02", min: 55, max: 60, avg: 58, observations: 3 },
    ]);
  });

  it("combines same-day rows across searches: cheapest min, highest max, mean avg", () => {
    const days = combineDailyStats([
      row("2026-10-01", 120, 180, 150, 2),
      row("2026-10-01", 90, 140, 110, 4),
    ]);
    expect(days).toEqual([
      { date: "2026-10-01", min: 90, max: 180, avg: 130, observations: 6 },
    ]);
  });

  it("drops a search's row when its min is missing but keeps the day", () => {
    const days = combineDailyStats([
      row("2026-10-01", null, 180, 150),
      row("2026-10-01", 95, 120, 100),
    ]);
    expect(days).toEqual([
      { date: "2026-10-01", min: 95, max: 120, avg: 100, observations: 1 },
    ]);
  });

  it("drops a day where every row has no usable minimum", () => {
    expect(combineDailyStats([row("2026-10-01", null, 180, 150)])).toEqual([]);
  });

  it("falls back to the min when max or avg are missing", () => {
    const days = combineDailyStats([row("2026-10-01", 70, null, null)]);
    expect(days).toEqual([
      { date: "2026-10-01", min: 70, max: 70, avg: 70, observations: 1 },
    ]);
  });

  it("handles searches that observed different days without inventing points", () => {
    const days = combineDailyStats([
      row("2026-10-01", 100, 120, 110),
      row("2026-10-03", 80, 90, 85),
    ]);
    expect(days.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-03"]);
  });
});

describe("routineAverage", () => {
  it("is null with no history", () => {
    expect(routineAverage([])).toBeNull();
  });

  it("is the mean of the combined daily minimums", () => {
    const days = combineDailyStats([
      row("2026-10-01", 100, 120, 110),
      row("2026-10-02", 80, 90, 85),
    ]);
    expect(routineAverage(days)).toBe(90);
  });
});
