import { describe, expect, it } from "vitest";

import { browserPlan, stepTimeout } from "./playwright-fetcher";

describe("browserPlan", () => {
  it("prefers an explicit CHROMIUM_PATH over everything", () => {
    expect(browserPlan({ CHROMIUM_PATH: "/usr/bin/chromium", VERCEL: "1" })).toBe(
      "chromium_path",
    );
  });

  it("uses the wireframe on Vercel, where a full bundle does not fit", () => {
    expect(browserPlan({ VERCEL: "1" })).toBe("vercel");
  });

  it("falls back to playwright-core's own browser", () => {
    expect(browserPlan({})).toBe("playwright");
  });
});

describe("stepTimeout", () => {
  const cap = 45_000;

  it("never waits longer than the per-operation cap", () => {
    expect(stepTimeout(100_000, 0, cap)).toBe(cap);
  });

  it("waits only what is left of the budget", () => {
    expect(stepTimeout(100_000, 70_000, cap)).toBe(30_000);
  });

  it("reports an exhausted budget as 0 so the caller gives up", () => {
    expect(stepTimeout(100_000, 100_000, cap)).toBe(0);
    expect(stepTimeout(100_000, 140_000, cap)).toBe(0);
  });
});
