import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { signOut } from "@/app/actions/auth";
import { SearchesView } from "@/components/search/searches-view";
import { CurrencyForm } from "@/components/profile/currency-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard | Flight Deal Tracker",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: searches } = await supabase
    .from("searches")
    .select("*")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: true });

  const searchIds = (searches ?? []).map((s) => s.id);

  type ExecutionRow = {
    search_id: string;
    id: string;
    status: string;
    finished_at: string | null;
    created_at: string;
  };

  const lastExecution = new Map<string, ExecutionRow>();
  if (searchIds.length > 0) {
    const { data: executions } = await supabase
      .from("search_executions")
      .select("search_id, id, status, finished_at, created_at")
      .in("search_id", searchIds)
      .order("created_at", { ascending: false });
    for (const exec of (executions ?? []) as ExecutionRow[]) {
      if (!lastExecution.has(exec.search_id))
        lastExecution.set(exec.search_id, exec);
    }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("currency")
    .eq("id", user.id)
    .single();

  type DailyStat = { search_id: string; stats_date: string; min_price_eur: number | null };
  const trends = new Map<string, number>();
  if (searchIds.length > 0) {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const { data: stats } = await supabase
      .from("price_stats_daily")
      .select("search_id, stats_date, min_price_eur")
      .in("search_id", searchIds)
      .gte("stats_date", weekAgo.toISOString().slice(0, 10));
    for (const s of (stats ?? []) as DailyStat[]) {
      if (s.min_price_eur === null) continue;
      const prev = trends.get(s.search_id);
      if (prev === undefined || s.min_price_eur < prev)
        trends.set(s.search_id, Number(s.min_price_eur));
    }
  }

  const trendRows = (searches ?? [])
    .filter((s) => trends.has(s.id))
    .map((s) => ({ search: s, min: trends.get(s.id) as number }))
    .sort((a, b) => a.min - b.min);

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Hola, {user.email}</p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="outline">
            Cerrar sesión
          </Button>
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Preferencias</CardTitle>
            <CardDescription>
              Moneda usada en precios y alertas de tus búsquedas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CurrencyForm current={profile?.currency ?? "EUR"} />
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
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
              <ul className="grid gap-2 sm:grid-cols-2">
                {trendRows.map(({ search, min }) => (
                  <li
                    key={search.id}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <span className="font-medium">
                      {search.origin} → {search.destination}
                    </span>
                    <span className="text-muted-foreground">
                      desde {min.toFixed(2)} {profile?.currency ?? "EUR"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <SearchesView
        searches={(searches ?? []).map((s) => ({
          ...s,
          lastExecution: lastExecution.get(s.id) ?? null,
        }))}
      />
    </main>
  );
}