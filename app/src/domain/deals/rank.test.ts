import { describe, expect, it } from "vitest";

import { cheapestIn, rankDeals, topIsProfileCurrency } from "./rank";

const eur = (price: number) => ({ price, currency: "EUR" });
const usd = (price: number) => ({ price, currency: "USD" });

describe("rankDeals", () => {
  it("never compares amounts across currencies", () => {
    // 90 USD is a smaller number than 95 EUR but they are not comparable, so
    // the profile-currency group leads and the other group follows.
    expect(rankDeals([usd(90), eur(95)], "EUR")).toEqual([eur(95), usd(90)]);
  });

  it("orders cheapest first inside each currency group", () => {
    expect(rankDeals([eur(120), eur(90), usd(50), usd(70)], "EUR")).toEqual([
      eur(90),
      eur(120),
      usd(50),
      usd(70),
    ]);
  });

  it("leads with the profile currency even when it is not first", () => {
    expect(rankDeals([usd(10), eur(500)], "USD")[0]).toEqual(usd(10));
  });

  it("keeps a single group sorted by price", () => {
    expect(rankDeals([eur(30), eur(10)], "EUR")).toEqual([eur(10), eur(30)]);
  });
});

describe("topIsProfileCurrency", () => {
  it("is false on an empty list", () => {
    expect(topIsProfileCurrency([], "EUR")).toBe(false);
  });

  it("is false when the leading group is not the profile currency", () => {
    expect(topIsProfileCurrency([usd(90), usd(95)], "EUR")).toBe(false);
  });

  it("is true when the leading group is the profile currency", () => {
    expect(topIsProfileCurrency([eur(95), usd(90)], "EUR")).toBe(true);
  });
});

describe("cheapestIn", () => {
  it("returns null for an empty list", () => {
    expect(cheapestIn([], "EUR")).toBeNull();
  });

  it("returns the profile-currency cheapest, not the smallest number", () => {
    expect(cheapestIn([usd(90), eur(95)], "EUR")).toEqual(eur(95));
  });

  it("falls back to the cheapest of any currency when the profile one is absent", () => {
    const best = cheapestIn([usd(90), usd(70)], "EUR");
    expect(best).toEqual(usd(70));
  });
});
