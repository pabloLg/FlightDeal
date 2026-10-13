import { describe, expect, it } from "vitest";

import { fetchFlexWindow, flexOffsets, shiftDate } from "./flex-window";
import type { FlightOption, FlightSearchParams } from "./types";

const params: FlightSearchParams = {
  origin: "MAD",
  destination: "BCN",
  departDate: "2026-10-15",
  returnDate: "2026-10-22",
  tripType: "round_trip",
  cabinClass: "economy",
  stops: "any",
  adults: 1,
  currency: "EUR",
};

function option(id: string): FlightOption {
  return {
    id,
    price: 100,
    currency: "EUR",
    outboundLegs: [],
    inboundLegs: [],
    airlines: [],
    totalDurationMin: 0,
  };
}

describe("shiftDate", () => {
  it("crosses month and year boundaries", () => {
    expect(shiftDate("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-10-15", 0)).toBe("2026-10-15");
  });
});

describe("flexOffsets", () => {
  it("asks the base date first, then expands outward", () => {
    expect(flexOffsets(2)).toEqual([0, 1, -1, 2, -2]);
    expect(flexOffsets(0)).toEqual([0]);
  });

  it("caps the window at the DB limit", () => {
    expect(flexOffsets(99)).toHaveLength(43);
  });
});

describe("fetchFlexWindow", () => {
  it("concatenates every answered day in offset order", async () => {
    const asked: string[] = [];
    const out = await fetchFlexWindow({ ...params, flexDays: 1 }, async (day) => {
      asked.push(day.departDate);
      expect(day.flexDays).toBeUndefined();
      return { ok: true, options: [option(day.departDate)], currency: "EUR" };
    });

    expect(asked).toEqual(["2026-10-15", "2026-10-16", "2026-10-14"]);
    expect(out.options.map((o) => o.id)).toEqual([
      "2026-10-15",
      "2026-10-16",
      "2026-10-14",
    ]);
    expect(out.degraded).toBe(false);
  });

  it("shifts the return date with the depart date", async () => {
    const returns: (string | undefined)[] = [];
    await fetchFlexWindow({ ...params, flexDays: 1 }, async (day) => {
      returns.push(day.returnDate);
      return { ok: true, options: [], currency: "EUR" };
    });

    expect(returns).toEqual(["2026-10-22", "2026-10-23", "2026-10-21"]);
  });

  it("reports a fully-answered empty window as no_flights", async () => {
    const out = await fetchFlexWindow({ ...params, flexDays: 1 }, async () => ({
      ok: true,
      options: [],
      currency: "EUR",
    }));

    expect(out).toMatchObject({ degraded: false, message: "no_flights", options: [] });
  });

  it("degrades on the first day's reason when nothing is usable", async () => {
    const out = await fetchFlexWindow({ ...params, flexDays: 1 }, async (day) =>
      day.departDate === "2026-10-16"
        ? { ok: false, message: "http_429" }
        : { ok: true, options: [], currency: "EUR" },
    );

    expect(out.degraded).toBe(true);
    expect(out.message).toBe("flex_partial:http_429");
  });

  it("keeps the days that answered even when another day degrades", async () => {
    const out = await fetchFlexWindow({ ...params, flexDays: 1 }, async (day) =>
      day.departDate === "2026-10-16"
        ? { ok: false, message: "http_429" }
        : { ok: true, options: [option(day.departDate)], currency: "EUR" },
    );

    expect(out.degraded).toBe(false);
    expect(out.options.map((o) => o.id)).toEqual(["2026-10-15", "2026-10-14"]);
  });

  it("truncates on the wall-clock budget instead of unbounded enumeration", async () => {
    let calls = 0;
    const out = await fetchFlexWindow(
      { ...params, flexDays: 5 },
      async () => {
        calls++;
        return { ok: true, options: [], currency: "EUR" };
      },
      0,
    );

    expect(calls).toBe(0);
    expect(out.degraded).toBe(true);
    expect(out.message).toBe("flex_partial:budget_exhausted");
  });
});
