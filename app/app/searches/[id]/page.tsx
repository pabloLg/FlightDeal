import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Resultados | Flight Deal Tracker",
};

type Leg = {
  airline: string;
  flightNumber: string;
  departAirport: string;
  arriveAirport: string;
  departAt: string;
  arriveAt: string;
  durationMin: number;
};

type FlightOptionRow = {
  id: string;
  price_eur: number;
  currency: string;
  outbound_legs: Leg[];
  inbound_legs: Leg[];
  airlines: string[];
  total_duration_min: number | null;
};

type PriceStatRow = {
  stats_date: string;
  min_price_eur: number;
  max_price_eur: number;
  avg_price_eur: number;
  observations: number;
};

type DispatchRow = {
  id: string;
  price_eur: number;
  status: "dispatched" | "delivered" | "failed";
  dispatched_at: string;
  alerts_edge:
    | { threshold_eur: number; provider: string }
    | { threshold_eur: number; provider: string }[]
    | null;
};

function PriceHistory({
  stats,
  currency,
}: {
  stats: PriceStatRow[];
  currency: string;
}) {
  const max = Math.max(...stats.map((s) => s.max_price_eur));

  return (
    <div className="flex flex-col gap-2">
      {stats.map((s) => {
        const barH = Math.max(6, Math.round((s.min_price_eur / max) * 100));
        return (
          <div key={s.stats_date} className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0">
              {new Date(s.stats_date).toLocaleDateString("es-ES")}
            </span>
            <div className="flex h-16 flex-1 items-end gap-1">
              <div
                className="w-4 rounded-t bg-primary"
                title={`mín ${s.min_price_eur.toFixed(2)} ${currency}`}
                style={{ height: `${barH}%` }}
              />
            </div>
            <span className="w-28 shrink-0 text-right tabular-nums">
              {s.min_price_eur.toFixed(2)} – {s.max_price_eur.toFixed(2)} {currency}
            </span>
            <span className="w-24 shrink-0 text-right text-muted-foreground tabular-nums">
              media {s.avg_price_eur.toFixed(2)} {currency}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function LegList({ legs }: { legs: Leg[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {legs.map((leg, i) => (
        <li key={i} className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium">
            {leg.airline} {leg.flightNumber}
          </span>
          <span>
            {leg.departAirport} {fmtTime(leg.departAt)}
          </span>
          <span className="text-muted-foreground">→</span>
          <span>
            {leg.arriveAirport} {fmtTime(leg.arriveAt)}
          </span>
          <span className="text-muted-foreground">({fmtDuration(leg.durationMin)})</span>
        </li>
      ))}
    </ul>
  );
}

function edgeOf(
  d: DispatchRow,
): { threshold_eur: number; provider: string } | undefined {
  if (!d.alerts_edge) return undefined;
  return Array.isArray(d.alerts_edge) ? d.alerts_edge[0] : d.alerts_edge;
}

function AlertHistory({
  dispatches,
  currency,
}: {
  dispatches: DispatchRow[];
  currency: string;
}) {
  const statusLabel: Record<DispatchRow["status"], string> = {
    dispatched: "Enviada",
    delivered: "Entregada",
    failed: "Fallida",
  };

  return (
    <div className="flex flex-col gap-2">
      {dispatches.map((d) => {
        const edge = edgeOf(d);
        return (
          <div
            key={d.id}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-muted-foreground">
              {new Date(d.dispatched_at).toLocaleString("es-ES")}
            </span>
            <span className="font-medium tabular-nums">
              {d.price_eur.toFixed(2)} {currency}
              {edge ? (
                <span className="text-muted-foreground">
                  {" "}
                  · umbral {edge.threshold_eur.toFixed(2)} {currency}
                </span>
              ) : null}
            </span>
            <span className="w-24 text-right">{statusLabel[d.status]}</span>
          </div>
        );
      })}
    </div>
  );
}

export default async function SearchResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: search, error: searchError } = await supabase
    .from("searches")
    .select("id, origin, destination")
    .eq("id", id)
    .single();
  if (searchError || !search) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("currency")
    .eq("id", user.id)
    .single();
  const currency = profile?.currency ?? "EUR";

  const { data: execution, error: executionError } = await supabase
    .from("search_executions")
    .select("id, status, finished_at")
    .eq("search_id", id)
    .in("status", ["completed", "degraded"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (executionError || !execution) notFound();

  const { data: options } = await supabase
    .from("flight_options")
    .select("id, price_eur, currency, outbound_legs, inbound_legs, airlines, total_duration_min")
    .eq("execution_id", execution.id)
    .order("price_eur", { ascending: true });

  const rows = (options ?? []) as FlightOptionRow[];

  const { data: stats } = await supabase
    .from("price_stats_daily")
    .select("stats_date, min_price_eur, max_price_eur, avg_price_eur, observations")
    .eq("search_id", id)
    .order("stats_date", { ascending: true });

  const statsRows = (stats ?? []) as PriceStatRow[];

const { data: dispatches } = await supabase
  .from("alert_dispatches")
  .select(
    "id, price_eur, status, dispatched_at, alerts_edge(threshold_eur, provider)",
  )
  .order("dispatched_at", { ascending: false });

const dispatchRows = (dispatches ?? []) as DispatchRow[];

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {search.origin} → {search.destination}
          </h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} opciones · completada el{" "}
            {execution.finished_at
              ? new Date(execution.finished_at).toLocaleDateString("es-ES")
              : "—"}
          </p>
        </div>
        <Button variant="outline" render={<Link href="/dashboard" />}>
          Volver al dashboard
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sin resultados</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              La última ejecución no encontró vuelos para esta búsqueda.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {rows.map((option) => (
            <Card key={option.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>
                    {option.airlines.join(", ")}
                    <span className="ml-2 text-muted-foreground">
                      {option.total_duration_min
                        ? fmtDuration(option.total_duration_min)
                        : ""}
                    </span>
                  </CardTitle>
                  <span className="text-lg font-semibold tabular-nums">
                    {option.price_eur.toFixed(2)} {option.currency}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <LegList legs={option.outbound_legs} />
                {option.inbound_legs.length > 0 && (
                  <>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Regreso
                    </span>
                    <LegList legs={option.inbound_legs} />
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Histórico de precios</CardTitle>
        </CardHeader>
        <CardContent>
          {statsRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no hay datos históricos. Los agregados diarios (mínimo, máximo
              y media) aparecerán tras las próximas ejecuciones de esta búsqueda.
            </p>
          ) : (
            <PriceHistory stats={statsRows} currency={currency} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alertas</CardTitle>
        </CardHeader>
        <CardContent>
          {dispatchRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no se ha disparado ninguna alerta para esta búsqueda. Se
              disparan cuando el mejor precio baja del umbral configurado.
            </p>
          ) : (
            <AlertHistory dispatches={dispatchRows} currency={currency} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}