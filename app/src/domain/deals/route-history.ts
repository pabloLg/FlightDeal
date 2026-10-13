// Route history: daily aggregates for a whole route (every search on the same
// origin + destination + trip type), not for a single search. price_stats_daily
// already stores one min/max/avg per search per day in EUR; these rows are
// combined per day so the search page can draw the route's observed minimum
// instead of only the current search's. Nothing is invented: a day appears only
// if at least one search observed a price that day.

export type RouteStatRow = {
  stats_date: string;
  min_price_eur: number | null;
  max_price_eur: number | null;
  avg_price_eur: number | null;
  observations: number | null;
};

export type RouteHistoryDay = {
  date: string;
  /** Cheapest of the day's minimums across every search of the route. */
  min: number;
  /** Highest of the day's maximums across every search of the route. */
  max: number;
  /** Mean of the searches' daily averages (falls back to min when absent). */
  avg: number;
  /** Total observations across the route that day. */
  observations: number;
};

const numberOr = (value: number | null | undefined): number | null => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const mean = (values: number[], fallback: number): number =>
  values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : fallback;

// One row per calendar day, ascending. Days where no search observed a usable
// minimum are dropped: with no min there is no point to draw.
export function combineDailyStats(rows: RouteStatRow[]): RouteHistoryDay[] {
  const byDate = new Map<string, RouteStatRow[]>();
  for (const row of rows) {
    if (numberOr(row.min_price_eur) == null) continue;
    const list = byDate.get(row.stats_date);
    if (list) list.push(row);
    else byDate.set(row.stats_date, [row]);
  }

  const days: RouteHistoryDay[] = [];
  for (const [date, list] of byDate) {
    const mins = list.map((r) => numberOr(r.min_price_eur) as number);
    const maxs = list
      .map((r) => numberOr(r.max_price_eur))
      .filter((v): v is number => v != null);
    const avgs = list
      .map((r) => numberOr(r.avg_price_eur))
      .filter((v): v is number => v != null);
    const min = Math.min(...mins);
    days.push({
      date,
      min,
      // Fall back to the min so a missing max/avg never turns into a fake 0.
      max: maxs.length > 0 ? Math.max(...maxs) : min,
      avg: mean(avgs, min),
      observations: list.reduce((acc, r) => acc + (numberOr(r.observations) ?? 0), 0),
    });
  }

  return days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// The route's "habitual" price: the mean of its observed daily minimums, i.e.
// the same series the chart draws, so the current price is compared against
// what the user sees. Null when there is no history.
export function routineAverage(days: RouteHistoryDay[]): number | null {
  if (days.length === 0) return null;
  return days.reduce((acc, d) => acc + d.min, 0) / days.length;
}
