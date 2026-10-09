// Ordering rules for prices, without pretending amounts in different
// currencies are comparable (there is no reliable FX in this app). Amounts
// are only ever compared inside the same currency: the profile currency
// group leads, then everyone else, cheapest first inside each group.

export interface RankableDeal {
  price: number;
  currency: string;
}

const upper = (value: string | null | undefined): string =>
  (value ?? "").trim().toUpperCase();

function groupOf(deal: RankableDeal, profileCurrency: string): number {
  return upper(deal.currency) === upper(profileCurrency) ? 0 : 1;
}

export function rankDeals<T extends RankableDeal>(
  deals: T[],
  profileCurrency: string,
): T[] {
  return [...deals].sort(
    (a, b) => groupOf(a, profileCurrency) - groupOf(b, profileCurrency) || a.price - b.price,
  );
}

// True when the first ranked deal is in the profile currency, i.e. when a
// single global "best" badge compares like with like. False on an empty list
// or when the cheapest options are all quoted elsewhere.
export function topIsProfileCurrency(
  deals: RankableDeal[],
  profileCurrency: string,
): boolean {
  if (deals.length === 0) return false;
  return upper(deals[0].currency) === upper(profileCurrency);
}

// Cheapest option for one search, preferring the profile currency. Returns
// the currency it was quoted in so callers never display an assumed EUR.
export function cheapestIn(
  list: RankableDeal[],
  profileCurrency: string,
): RankableDeal | null {
  if (list.length === 0) return null;
  return rankDeals(list, profileCurrency)[0];
}
