import { describe, expect, it } from "vitest";

import { isoDaysAgo } from "./date-window";

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
