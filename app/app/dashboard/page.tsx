import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecentAlertsCard } from "@/components/alerts/recent-alerts";
import { type Deal as DealType } from "@/components/deals/deal-card";
import { FeaturedDeals } from "@/components/deals/featured-deals";
import { SearchHero } from "@/components/search/search-hero";
import { SearchesView } from "@/components/search/searches-view";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { isoDaysAgo } from "@/src/domain/deals/date-window";
import {
  cheapestIn,
  rankDeals,
  topIsProfileCurrency,
  type RankableDeal,
} from "@/src/domain/deals/rank";
import type { FlightLeg } from "@/src/domain/sources/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Descubrir | FlightDeal",
};

type ExecutionRow = {
  search_id: string;
  id: string;
  status: string;
  finished_at: string | null;
  created_at: string;
};

type FlightOptionRow = {
  id: string;
  search_id: string;
  execution_id: string;
  price_eur: number;
  currency: string;
  airlines: string[] | null;
  total_duration_min: number | null;
  outbound_legs: unknown;
  inbound_legs: unknown;
};

type StatRow = {
  search_id: string;
  stats_date: string;
  min_price_eur: number | null;
  avg_price_eur: number | null;
};

// Shape of a dispatch joined to its alert edge and, through it, its search.
// Only used to label the row with a route; nothing here is written back.
type DispatchRow = {
  id: string;
  price_eur: number;
  status: "dispatched" | "delivered" | "failed";
  dispatched_at: string;
  alerts_edge:
    | {
        threshold_eur: number | null;
        searches: { origin: string; destination: string } | { origin: string; destination: string }[];
      }
    | {
        threshold_eur: number | null;
        searches: { origin: string; destination: string } | { origin: string; destination: string }[];
      }[];
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Profile currency decides which group leads and which badge is honest, so
  // it is fetched next to the searches instead of at the end of the page.
  const [{ data: searches }, { data: profile }] = await Promise.all([
    supabase
      .from("searches")
      .select("*")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("currency").eq("id", user.id).single(),
  ]);
  const profileCurrency = profile?.currency ?? "EUR";

  const searchIds = (searches ?? []).map((s) => s.id);

  const lastExecution = new Map<string, ExecutionRow>();
  const resultsExecution = new Map<string, string>();
  const baselineBySearch = new Map<string, number>();
  const trendBySearch = new Map<string, number>();
  if (searchIds.length > 0) {
    // Executions and stats share no dependency, so they run together.
    const [{ data: executions }, { data: stats }] = await Promise.all([
      supabase
        .from("search_executions")
        .select("search_id, id, status, finished_at, created_at")
        .in("search_id", searchIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("price_stats_daily")
        .select("search_id, stats_date, min_price_eur, avg_price_eur")
        .in("search_id", searchIds)
        .gte("stats_date", isoDaysAgo(30)),
    ]);

    for (const exec of (executions ?? []) as ExecutionRow[]) {
      if (!lastExecution.has(exec.search_id))
        lastExecution.set(exec.search_id, exec);
      if (
        !resultsExecution.has(exec.search_id) &&
        (exec.status === "completed" || exec.status === "degraded")
      ) {
        resultsExecution.set(exec.search_id, exec.id);
      }
    }

    const avgAcc = new Map<string, { sum: number; n: number }>();
    const weekAgo = isoDaysAgo(7);
    for (const s of (stats ?? []) as StatRow[]) {
      if (s.avg_price_eur != null) {
        const acc = avgAcc.get(s.search_id) ?? { sum: 0, n: 0 };
        acc.sum += Number(s.avg_price_eur);
        acc.n += 1;
        avgAcc.set(s.search_id, acc);
      }
      if (s.min_price_eur != null && s.stats_date >= weekAgo) {
        const prev = trendBySearch.get(s.search_id);
        if (prev === undefined || Number(s.min_price_eur) < prev)
          trendBySearch.set(s.search_id, Number(s.min_price_eur));
      }
    }
    for (const [id, acc] of avgAcc) {
      baselineBySearch.set(id, acc.sum / acc.n);
    }
  }

  const optionsBySearch = new Map<string, FlightOptionRow[]>();
  if (resultsExecution.size > 0) {
    const { data: options } = await supabase
      .from("flight_options")
      .select(
        "id, search_id, execution_id, price_eur, currency, airlines, total_duration_min, outbound_legs, inbound_legs",
      )
      .in("execution_id", [...resultsExecution.values()])
      .order("price_eur", { ascending: true });
    for (const opt of (options ?? []) as FlightOptionRow[]) {
      const list = optionsBySearch.get(opt.search_id);
      if (list) list.push(opt);
      else optionsBySearch.set(opt.search_id, [opt]);
    }
  }

  // Cheapest option per search with the currency it was quoted in: a search
  // whose sources quote different currencies shows the profile-currency one
  // and never an assumed EUR.
  const cheapestBySearch = new Map<string, RankableDeal>();
  for (const [id, list] of optionsBySearch) {
    const cheapest = cheapestIn(
      list.map((opt) => ({ price: Number(opt.price_eur), currency: opt.currency })),
      profileCurrency,
    );
    if (cheapest) cheapestBySearch.set(id, cheapest);
  }

  const deals: DealType[] = (searches ?? [])
    .flatMap((s) => {
      const executedAt = lastExecution.get(s.id)?.finished_at ?? null;
      const baseline = baselineBySearch.get(s.id) ?? null;
      return (optionsBySearch.get(s.id) ?? []).slice(0, 1).map(
        (opt) =>
          ({
            searchId: s.id,
            optionId: opt.id,
            origin: s.origin,
            destination: s.destination,
            departDate: s.depart_date,
            returnDate: s.return_date,
            tripType: s.trip_type,
            cabinClass: s.cabin_class,
            stops: s.stops,
            adults: s.adults,
            price: Number(opt.price_eur),
            currency: opt.currency,
            airlines: opt.airlines ?? [],
            legs: (opt.outbound_legs ?? []) as FlightLeg[],
            totalDurationMin: opt.total_duration_min,
            baseline,
            executedAt,
          }) satisfies DealType,
      );
    });

  // Amounts in different currencies are never compared: the profile-currency
  // group leads and only that group earns the global "best opportunity" badge.
  const rankedDeals = rankDeals(deals, profileCurrency);
  const featuredIsHonest = topIsProfileCurrency(rankedDeals, profileCurrency);

  const trendRows = (searches ?? [])
    .filter((s) => trendBySearch.has(s.id))
    .map((s) => ({ search: s, min: trendBySearch.get(s.id) as number }))
    .sort((a, b) => a.min - b.min);

  // Recent alerts, scoped to this profile by RLS. The join to searches exists
  // only to label each dispatch with its route; there is no second source of
  // truth for alerts. Dispatches store price_eur: alerts are evaluated
  // against a EUR threshold, so both numbers are shown in EUR.
  const { data: dispatches } = await supabase
    .from("alert_dispatches")
    .select(
      "id, price_eur, status, dispatched_at, alerts_edge!inner(threshold_eur, searches!inner(origin, destination))",
    )
    .order("dispatched_at", { ascending: false })
    .limit(8);

  const recentAlerts = ((dispatches ?? []) as unknown as DispatchRow[]).map(
    (dispatch) => {
      const edge = Array.isArray(dispatch.alerts_edge)
        ? dispatch.alerts_edge[0]
        : dispatch.alerts_edge;
      const search = Array.isArray(edge?.searches)
        ? edge.searches[0]
        : edge?.searches;
      return {
        id: dispatch.id,
        route: search
          ? `${search.origin} → ${search.destination}`
          : "Ruta desconocida",
        thresholdEur: edge?.threshold_eur ?? null,
        price: Number(dispatch.price_eur),
        status: dispatch.status,
        dispatchedAt: dispatch.dispatched_at,
      };
    },
  );

  const lastCheckedAt = (searches ?? [])
    .map((s) => lastExecution.get(s.id)?.finished_at ?? null)
    .filter((value): value is string => value != null)
    .sort()
    .at(-1) ?? null;

  return (
    <main className="mx-auto flex w-full max-w-[1420px] flex-col gap-8 px-6 pb-16">
      <SearchHero
        summary={{
          searches: searchIds.length,
          priced: cheapestBySearch.size,
          lastCheckedAt,
        }}
      />

      <FeaturedDeals
        deals={rankedDeals}
        searchCount={searchIds.length}
        featuredIsHonest={featuredIsHonest}
      />

      <section id="searches" className="scroll-mt-24">
        <SearchesView
          searches={(searches ?? []).map((s) => ({
            ...s,
            lastExecution: lastExecution.get(s.id) ?? null,
            bestPrice: cheapestBySearch.get(s.id) ?? null,
          }))}
          currency={profileCurrency}
        />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section id="trends" className="scroll-mt-24">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Tendencias (últimos 7 días)</CardTitle>
              <CardDescription>
                Mejores precios observados por ruta entre tus búsquedas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {trendRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Todavía no hay datos. Ejecuta una búsqueda para ver tendencias.
                </p>
              ) : (
                <>
                  {profileCurrency !== "EUR" && (
                    <p className="mb-2 text-xs text-muted-foreground">
                      Histórico disponible en EUR.
                    </p>
                  )}
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    {trendRows.map(({ search, min }) => (
                      <li
                        key={search.id}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <span className="font-medium text-brand-dark">
                          {search.origin} → {search.destination}
                        </span>
                        <span className="text-muted-foreground">
                          desde {min.toFixed(2)} EUR
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        </section>

        <div className="scroll-mt-24">
          <RecentAlertsCard alerts={recentAlerts} />
        </div>
      </div>
    </main>
  );
}
