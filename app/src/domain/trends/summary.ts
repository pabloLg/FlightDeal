// Trends summary: pure helpers that turn the daily aggregates the app already
// stores into the route cards the /trends page shows. price_stats_daily holds
// one min/avg/max per search per day, in EUR, so every number here is EUR and
// nothing is compared across currencies. No point between two observations is
// ever invented: a series is only the days that were actually recorded.

export type TrendPeriod = "7" | "30" | "all";

export type SearchLike = {
  id: string;
  origin: string;
  destination: string;
  depart_date: string | null;
  return_date: string | null;
  trip_type: string;
  date_flex_days: number;
};

export type StatLike = {
  search_id: string;
  /** Aggregation day (YYYY-MM-DD), not the time of the check. */
  stats_date: string;
  min_price_eur: number | null;
};

export type RouteTrend = {
  search: SearchLike;
  /** Days with an observed min, ascending, inside the period. */
  days: { date: string; min: number }[];
  minPeriod: number;
  firstMin: number;
  lastMin: number;
  firstDate: string;
  lastDate: string;
  /** (lastMin - firstMin) / firstMin * 100, null with fewer than 2 days. */
  change: number | null;
  /** Real last check (search_executions.finished_at), distinct from stats_date. */
  lastCheckAt: string | null;
};

export type TrendIndicators = {
  routeCount: number;
  minPrice: number | null;
  dropCount: number;
};

// Calendar-day shift on ISO dates. Values are date-only, so UTC arithmetic
// never moves a day across a timezone.
export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Lower bound of a period: 7 days = today plus the 6 days before it, 30 = today
// plus the 29 before it. "all" has no lower bound. The upper bound (today) is
// always enforced in buildTrends, so the future is never shown.
export function periodFrom(period: TrendPeriod, today: string): string | null {
  if (period === "all") return null;
  return shiftIsoDate(today, period === "7" ? -6 : -29);
}

// One route per search: a search already fixes the comparable conditions
// (origin, destination, departure/return dates, trip type), so two searches on
// the same city pair with different dates stay two separate routes and a
// one-way is never folded into a round-trip.
export function buildTrends(
  searches: SearchLike[],
  stats: StatLike[],
  lastCheckBySearch: Record<string, string | null>,
  options: { period: TrendPeriod; today: string },
): RouteTrend[] {
  const from = periodFrom(options.period, options.today);
  const bySearch = new Map<string, { date: string; min: number }[]>();

  for (const s of stats) {
    if (s.min_price_eur == null) continue;
    if (s.stats_date > options.today) continue;
    if (from !== null && s.stats_date < from) continue;
    const point = { date: s.stats_date, min: Number(s.min_price_eur) };
    const list = bySearch.get(s.search_id);
    if (list) list.push(point);
    else bySearch.set(s.search_id, [point]);
  }

  const routes: RouteTrend[] = [];
  for (const search of searches) {
    const raw = bySearch.get(search.id);
    if (!raw || raw.length === 0) continue;

    raw.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // The unique (search_id, stats_date) constraint guarantees one row per day;
    // collapsing duplicates keeps the series a true daily minimum if it ever
    // changes.
    const days: { date: string; min: number }[] = [];
    for (const d of raw) {
      const prev = days[days.length - 1];
      if (prev && prev.date === d.date) prev.min = Math.min(prev.min, d.min);
      else days.push({ ...d });
    }

    const first = days[0];
    const last = days[days.length - 1];
    const change =
      days.length >= 2 && first.min > 0
        ? ((last.min - first.min) / first.min) * 100
        : null;

    routes.push({
      search,
      days,
      minPeriod: Math.min(...days.map((d) => d.min)),
      firstMin: first.min,
      lastMin: last.min,
      firstDate: first.date,
      lastDate: last.date,
      change,
      lastCheckAt: lastCheckBySearch[search.id] ?? null,
    });
  }
  return routes;
}

export function summarize(routes: RouteTrend[]): TrendIndicators {
  return {
    routeCount: routes.length,
    minPrice: routes.length > 0 ? Math.min(...routes.map((r) => r.minPeriod)) : null,
    dropCount: routes.filter((r) => r.change !== null && r.change < 0).length,
  };
}

export type RouteFilter = { origin: string; destination: string };

export function filterRoutes(routes: RouteTrend[], f: RouteFilter): RouteTrend[] {
  return routes.filter(
    (r) =>
      (!f.origin || r.search.origin === f.origin) &&
      (!f.destination || r.search.destination === f.destination),
  );
}

export type RouteSort = "min" | "drop" | "recent";

export function sortRoutes(routes: RouteTrend[], sort: RouteSort): RouteTrend[] {
  const copy = [...routes];
  if (sort === "min") return copy.sort((a, b) => a.minPeriod - b.minPeriod);
  if (sort === "drop")
    return copy.sort((a, b) => {
      // Biggest drop (most negative) first; routes with no comparable change
      // go last instead of pretending a null is a 0% move.
      const av = a.change ?? Number.POSITIVE_INFINITY;
      const bv = b.change ?? Number.POSITIVE_INFINITY;
      return av - bv || a.minPeriod - b.minPeriod;
    });
  return copy.sort((a, b) =>
    a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0,
  );
}

// Presentation-only pick for the dashboard teaser: recent routes (observed in
// the 7-day window) lead, drops among them first, then the rest by most recent
// observation. This is NOT a ranking of best opportunities; it only decides
// which routes fit in the compact card.
export function pickDashboardRoutes(
  routes: RouteTrend[],
  today: string,
  limit = 3,
): RouteTrend[] {
  const recentFrom = periodFrom("7", today) ?? "";
  const isRecent = (r: RouteTrend) => r.lastDate >= recentFrom;
  const hasDrop = (r: RouteTrend) => r.change !== null && r.change < 0;
  const byRecent = (a: RouteTrend, b: RouteTrend) =>
    a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0;

  return [
    ...routes.filter((r) => isRecent(r) && hasDrop(r)).sort(byRecent),
    ...routes.filter((r) => isRecent(r) && !hasDrop(r)).sort(byRecent),
    ...routes.filter((r) => !isRecent(r)).sort(byRecent),
  ].slice(0, limit);
}
