import { describe, expect, it } from "vitest";

import { evaluateAlert } from "./evaluate-alert";

const NOW = "2026-09-25T12:00:00Z";

function base() {
  return {
    thresholdEur: 100,
    bestOption: { id: "opt-1", priceEur: 90 },
    lastFiredAt: null,
    cooldownHours: 24,
    now: NOW,
  };
}

describe("evaluateAlert", () => {
  it("fires when best option is at or below the threshold and no prior fire", () => {
    expect(evaluateAlert(base())).toEqual({
      shouldFire: true,
      reason: "price_at_or_below_threshold",
      priceEur: 90,
      optionId: "opt-1",
    });
  });

  it("fires exactly at the threshold", () => {
    expect(
      evaluateAlert({ ...base(), bestOption: { id: "opt-1", priceEur: 100 } }),
    ).toMatchObject({ shouldFire: true });
  });

  it("does not fire without a threshold", () => {
    expect(evaluateAlert({ ...base(), thresholdEur: null })).toEqual({
      shouldFire: false,
      reason: "no_threshold",
    });
  });

  it("does not fire without options", () => {
    expect(evaluateAlert({ ...base(), bestOption: null })).toEqual({
      shouldFire: false,
      reason: "no_options",
    });
  });

  it("does not fire above threshold", () => {
    expect(
      evaluateAlert({ ...base(), bestOption: { id: "opt-1", priceEur: 101 } }),
    ).toEqual({ shouldFire: false, reason: "price_above_threshold" });
  });

  it("respects cooldown window", () => {
    expect(
      evaluateAlert({
        ...base(),
        lastFiredAt: "2026-09-24T13:00:00Z", // 23h before
      }),
    ).toMatchObject({ shouldFire: false, reason: "cooldown_active" });
  });

  it("fires again once cooldown has elapsed", () => {
    expect(
      evaluateAlert({
        ...base(),
        lastFiredAt: "2026-09-24T11:00:00Z", // 25h before
      }),
    ).toMatchObject({ shouldFire: true });
  });
});