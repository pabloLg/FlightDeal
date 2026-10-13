import { afterEach, describe, expect, it, vi } from "vitest";

import { isStale, isoDaysAgo, outboundDepartDate } from "./date-window";

describe("outboundDepartDate", () => {
  it("slices the date-only departure of the first outbound leg", () => {
    expect(
      outboundDepartDate([
        { departAt: "2026-10-13T08:30:00", arriveAt: "2026-10-13T11:00:00" },
      ]),
    ).toBe("2026-10-13");
  });

  it("never shifts a date-only value across a timezone", () => {
    expect(outboundDepartDate([{ departAt: "2026-10-13" }])).toBe("2026-10-13");
  });

  it("returns null when there is no first leg or no departure", () => {
    expect(outboundDepartDate([])).toBeNull();
    expect(outboundDepartDate(undefined)).toBeNull();
    expect(outboundDepartDate([{}])).toBeNull();
    expect(outboundDepartDate([{ departAt: 20261013 }])).toBeNull();
  });
});

describe("isStale", () => {
  afterEach(() => vi.useRealTimers());

  it("is false for a timestamp within the last day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
    expect(isStale("2026-10-12T13:00:00Z")).toBe(false);
  });

  it("is true past 24 h and when there is no timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
    expect(isStale("2026-10-12T11:00:00Z")).toBe(true);
    expect(isStale(null)).toBe(false);
    expect(isStale("not a date")).toBe(false);
  });
});

describe("isoDaysAgo", () => {
  it("returns a YYYY-MM-DD date", () => {
    expect(isoDaysAgo(7)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("goes back exactly the requested number of days", () => {
    const expected = new Date();
    expected.setDate(expected.getDate() - 30);
    expect(isoDaysAgo(30)).toBe(expected.toISOString().slice(0, 10));
  });

  it("moves backwards in time", () => {
    expect(isoDaysAgo(30) < isoDaysAgo(7)).toBe(true);
  });
});
