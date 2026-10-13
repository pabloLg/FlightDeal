import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TrendsView } from "@/components/trends/trends-view";
import { createClient } from "@/lib/supabase/server";
import { isoDaysAgo } from "@/src/domain/deals/date-window";
import { cityMapFor } from "@/src/domain/sources/airports";
import type { SearchLike, StatLike } from "@/src/domain/trends/summary";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tendencias | FlightDeal",
};

export default async function TrendsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS scopes price_stats_daily and search_executions to the signed-in owner
  // through searches.profile_id, so this page only ever sees the user's data.
  const [{ data: searches }, { data: profile }] = await Promise.all([
    supabase
      .from("searches")
      .select(
        "id, origin, destination, depart_date, return_date, trip_type, date_flex_days",
      )
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("currency").eq("id", user.id).single(),
  ]);

  const searchList = (searches ?? []) as SearchLike[];
  const searchIds = searchList.map((s) => s.id);

  let stats: StatLike[] = [];
  const lastCheckBySearch: Record<string, string | null> = {};
  if (searchIds.length > 0) {
    const [{ data: statRows }, { data: execRows }] = await Promise.all([
      // Whole history: the period is chosen in the client, so "Todo" needs it
      // all. One row per search per day keeps this small.
      supabase
        .from("price_stats_daily")
        .select("search_id, stats_date, min_price_eur")
        .in("search_id", searchIds),
      supabase
        .from("search_executions")
        .select("search_id, finished_at")
        .in("search_id", searchIds)
        .order("created_at", { ascending: false }),
    ]);
    stats = (statRows ?? []) as StatLike[];
    // Newest run per search wins, but only a run that actually finished counts
    // as "la última comprobación": finished_at, not stats_date.
    for (const exec of (execRows ?? []) as {
      search_id: string;
      finished_at: string | null;
    }[]) {
      if (lastCheckBySearch[exec.search_id]) continue;
      if (exec.finished_at) lastCheckBySearch[exec.search_id] = exec.finished_at;
    }
  }

  const codes = new Set<string>();
  for (const s of searchList) {
    codes.add(s.origin);
    codes.add(s.destination);
  }

  return (
    <TrendsView
      searches={searchList}
      stats={stats}
      lastCheckBySearch={lastCheckBySearch}
      cities={cityMapFor(codes)}
      currency={profile?.currency ?? "EUR"}
      today={isoDaysAgo(0)}
    />
  );
}
