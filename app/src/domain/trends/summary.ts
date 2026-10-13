// Trends summary: pure helpers that turn the daily aggregates the app already
// stores into the route cards the /trends page shows. price_stats_daily holds
// one min/avg/max per search per day, in EUR, so every number here is EUR and
// nothing is compared across currencies. No point between two observations is
// ever invented: a series is only the days that were actually recorded.
//
// A route is the city pair plus the trip type, NOT a single search: several
// searches on the same pair (different dates, cabins...) are one card whose
// series is the per-day minimum across all of them. A one-way is never folded
// into a round-trip.

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
  /** Route identity: `${origin}|${destination}|${trip_type}`. */
  key: string;
  origin: string;
  destination: string;
  tripType: string;
  /** Member searches, in the order they arrived (the page sends newest first). */
  searches: SearchLike[];
  /** Distinct departure dates among members, ascending (nulls dropped). */
  departDates: string[];
  /** Member to link to: the one with the latest observation in the period. */
  latestSearchId: string;
  /** Days with the combined min, ascending, inside the period. */
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

// Two searches are the same route when origin, destination and trip type match;
// the departure dates are deliberately not part of the key so their series add
// up to one line.
export function routeKeyOf(
  s: Pick<SearchLike, "origin" | "destination" | "trip_type">,
): string {
  return `${s.origin}|${s.destination}|${s.trip_type}`;
}

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

// One route per city pair + trip type. Every search on that route contributes
// its daily minimum to the same series; a day observed by several searches
// keeps the cheapest one. The variation is over the combined line, not a single
// flight, and it is labelled as the observed daily minimum.
export function buildTrends(
  searches: SearchLike[],
  stats: StatLike[],
  lastCheckBySearch: Record<string, string | null>,
  options: { period: TrendPeriod; today: string },
): RouteTrend[] {
  const from = periodFrom(options.period, options.today);
  const searchById = new Map(searches.map((s) => [s.id, s]));

  // Group searches by route, preserving arrival order (newest first).
  const groups = new Map<string, { members: SearchLike[] }>();
  for (const s of searches) {
    const key = routeKeyOf(s);
    const g = groups.get(key);
    if (g) g.members.push(s);
    else groups.set(key, { members: [s] });
  }

  // route + day -> min across member searches; and per search, its latest day.
  const byRoute = new Map<string, Map<string, number>>();
  const lastDayBySearch = new Map<string, string>();
  for (const s of stats) {
    if (s.min_price_eur == null) continue;
    if (s.stats_date > options.today) continue;
    if (from !== null && s.stats_date < from) continue;
    const search = searchById.get(s.search_id);
    if (!search) continue;

    const last = lastDayBySearch.get(s.search_id);
    if (last === undefined || s.stats_date > last)
      lastDayBySearch.set(s.search_id, s.stats_date);

    const key = routeKeyOf(search);
    let byDate = byRoute.get(key);
    if (!byDate) {
      byDate = new Map();
      byRoute.set(key, byDate);
    }
    const v = Number(s.min_price_eur);
    const prev = byDate.get(s.stats_date);
    byDate.set(s.stats_date, prev === undefined ? v : Math.min(prev, v));
  }

  const routes: RouteTrend[] = [];
  for (const [key, { members }] of groups) {
    const byDate = byRoute.get(key);
    if (!byDate || byDate.size === 0) continue;

    const days = [...byDate.entries()]
      .map(([date, min]) => ({ date, min }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const first = days[0];
    const last = days[days.length - 1];
    const change =
      days.length >= 2 && first.min > 0
        ? ((last.min - first.min) / first.min) * 100
        : null;

    // Link target (latest observation) and the last finished check, both across
    // every search of the route. Ties keep the newest member.
    let latestSearchId = members[0].id;
    let latestDay = "";
    let lastCheckAt: string | null = null;
    for (const m of members) {
      const day = lastDayBySearch.get(m.id);
      if (day && day > latestDay) {
        latestDay = day;
        latestSearchId = m.id;
      }
      const t = lastCheckBySearch[m.id] ?? null;
      if (t && (lastCheckAt === null || t > lastCheckAt)) lastCheckAt = t;
    }

    const departDates = [
      ...new Set(
        members
          .map((m) => m.depart_date)
          .filter((d): d is string => d != null),
      ),
    ].sort();

    routes.push({
      key,
      origin: members[0].origin,
      destination: members[0].destination,
      tripType: members[0].trip_type,
      searches: members,
      departDates,
      latestSearchId,
      days,
      minPeriod: Math.min(...days.map((d) => d.min)),
      firstMin: first.min,
      lastMin: last.min,
      firstDate: first.date,
      lastDate: last.date,
      change,
      lastCheckAt,
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
      (!f.origin || r.origin === f.origin) &&
      (!f.destination || r.destination === f.destination),
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
