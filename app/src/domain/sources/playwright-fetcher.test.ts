import { describe, expect, it } from "vitest";

import { browserPlan, stepTimeout, withBudget } from "./playwright-fetcher";

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

describe("withBudget", () => {
  // The hang this guards: a cold lambda awaiting a Playwright call that takes
  // no timeout option (unpacking Chromium, newContext, content) had no ceiling
  // and ran out the whole 60 s invocation.
  it("passes through work that finishes in time", async () => {
    await expect(
      withBudget(Promise.resolve("html"), Date.now() + 1_000, "content"),
    ).resolves.toBe("html");
  });

  it("gives up on work that never settles instead of waiting forever", async () => {
    const never = new Promise<string>(() => {});
    await expect(withBudget(never, Date.now() + 20, "content")).rejects.toThrow(
      "budget_exhausted:content",
    );
  });

  it("refuses to start work at all once the budget is gone", async () => {
    let started = false;
    const work = Promise.resolve().then(() => {
      started = true;
      return "html";
    });
    await expect(withBudget(work, Date.now() - 1, "launch")).rejects.toThrow(
      "budget_exhausted:launch",
    );
    await work;
    expect(started).toBe(true);
  });
});
