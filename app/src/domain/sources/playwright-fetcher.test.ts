import { describe, expect, it } from "vitest";

import { browserPlan } from "./playwright-fetcher";

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
