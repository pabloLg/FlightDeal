import { describe, expect, it } from "vitest";

import { availableDatesOf, resolveDateView, type DatedOption } from "./date-view";

function opt(executionId: string, date: string, price = 100): DatedOption {
  const id = `${executionId}:${date}:${price}`;
  return {
    id,
    dedupe_key: id,
    price_eur: price,
    currency: "EUR",
    outbound_legs: [
      {
        airline: "UX",
        flightNumber: "1",
        departAirport: "MAD",
        arriveAirport: "BCN",
        departAt: `${date}T08:00:00`,
        arriveAt: `${date}T09:00:00`,
        durationMin: 60,
      },
    ],
    inbound_legs: [],
    airlines: ["UX"],
    total_duration_min: 60,
    source_id: null,
    booking_links: null,
    execution_id: executionId,
  };
}

const executions = [{ id: "new" }, { id: "old" }];

describe("availableDatesOf", () => {
  it("lists each day once, sorted", () => {
    const rows = [
      opt("old", "2026-10-02"),
      opt("old", "2026-10-01"),
      opt("new", "2026-10-02"),
    ];
    expect(availableDatesOf(rows)).toEqual(["2026-10-01", "2026-10-02"]);
  });
});

describe("resolveDateView", () => {
  it("returns only the newest execution's rows for the date", () => {
    const rows = [opt("new", "2026-10-02", 90), opt("old", "2026-10-02", 70)];
    const view = resolveDateView(rows, executions, "2026-10-02");
    expect(view.executionId).toBe("new");
    expect(view.rows.map((r) => r.price_eur)).toEqual([90]);
  });

  it("returns nothing for a day never searched", () => {
    const view = resolveDateView([opt("new", "2026-10-01")], executions, "2026-10-09");
    expect(view).toEqual({ rows: [], executionId: null });
  });
});
