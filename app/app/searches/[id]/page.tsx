import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { FlightDealCard } from "@/components/deals/flight-deal-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { buildBookingUrl } from "@/lib/flight-display";
import {
  airlineOptions,
  applyFilters,
  parseFilters,
  type FlightOptionRow,
} from "@/src/domain/deals/filters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Resultados | FlightDeal",
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
  currentPrice,
}: {
  stats: PriceStatRow[];
  currency: string;
  currentPrice: number | null;
}) {
  const max = Math.max(...stats.map((s) => s.max_price_eur));
  const hasHistory = stats.some((s) => s.observations > 0);
  const habitual =
    stats.reduce((acc, s) => acc + s.avg_price_eur, 0) / (stats.length || 1);
  const diff =
    currentPrice != null && habitual > 0
      ? Math.round((1 - currentPrice / habitual) * 100)
      : null;

  return (
    <div className="flex flex-col gap-2">
      {currentPrice != null && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span>
            <span className="font-medium">Precio actual:</span>{" "}
            {currentPrice.toFixed(2)} {currency}
          </span>
          {diff != null &&
            (diff >= 0 ? (
              <span className="font-semibold text-savings">
                −{diff}% frente al habitual
              </span>
            ) : (
              <span className="font-semibold text-opportunity">
                +{Math.abs(diff)}% frente al habitual
              </span>
            ))}
        </div>
      )}

      {stats.map((s) => {
        const barH = Math.max(6, Math.round((s.min_price_eur / max) * 100));
        return (
          <div key={s.stats_date} className="flex flex-wrap items-center gap-3 text-sm">
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
      {!hasHistory && (
        <p className="text-xs text-muted-foreground">
          Aún no hay datos históricos. Los agregados diarios (mínimo, máximo y media)
          aparecerán tras las próximas ejecuciones de esta búsqueda.
        </p>
      )}
    </div>
  );
}

/** Prices older than a day may be gone; the search cron runs daily at 06:00. */
function isStale(finishedAt: string | null): boolean {
  return (
    finishedAt != null &&
    Date.now() - new Date(finishedAt).getTime() > 24 * 60 * 60 * 1000
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: search, error: searchError } = await supabase
    .from("searches")
    .select(
      "id, origin, destination, depart_date, return_date, trip_type, cabin_class, stops, adults",
    )
    .eq("id", id)
    .single();
  if (searchError || !search) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("currency")
    .eq("id", user.id)
    .single();
  const currency = profile?.currency ?? "EUR";

  const { data: execution } = await supabase
    .from("search_executions")
    .select("id, status, finished_at, error_message")
    .eq("search_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const failed = execution?.status === "failed";
  if (
    !execution ||
    (!failed && execution.status !== "completed" && execution.status !== "degraded")
  )
    notFound();

  const { data: options } = await supabase
    .from("flight_options")
    .select("id, price_eur, currency, outbound_legs, inbound_legs, airlines, total_duration_min")
    .eq("execution_id", execution.id)
    .order("price_eur", { ascending: true });

  const allRows = (options ?? []) as FlightOptionRow[];
  const filters = parseFilters(await searchParams);
  const rows = applyFilters(allRows, filters);
  const bestPrice = allRows.length > 0 ? Number(allRows[0].price_eur) : null;
  const filtered =
    filters.maxPrice != null ||
    filters.maxDuration != null ||
    filters.nonStopOnly ||
    filters.airline != null;
  const airlines = airlineOptions(allRows);
  const stale = isStale(execution.finished_at);
  const bookingUrl = buildBookingUrl({
    origin: search.origin,
    destination: search.destination,
    depart_date: search.depart_date,
    return_date: search.return_date,
    trip_type: search.trip_type,
    cabin_class: search.cabin_class,
    stops: search.stops,
    adults: search.adults,
  });

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-brand-dark">
            {search.origin} → {search.destination}
          </h1>
          <p className="text-sm text-muted-foreground">
            {allRows.length} opciones · búsqueda completada el{" "}
            {execution.finished_at
              ? new Date(execution.finished_at).toLocaleDateString("es-ES")
              : "—"}
            {` · ${search.adults} pasajero${search.adults > 1 ? "s" : ""} · ${
              search.cabin_class === "economy" ? "economy" : search.cabin_class
            }`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" render={<Link href="/dashboard#searches" />}>
            🔔 Crear alerta
          </Button>
          <Button variant="ghost" render={<Link href="/dashboard" />}>
            Volver
          </Button>
        </div>
      </div>

      {stale && !failed && (
        <p className="rounded-lg bg-opportunity/10 px-3 py-2 text-sm text-opportunity">
          Estos precios son de hace más de 24 h y pueden haber cambiado. Ejecuta la
          búsqueda de nuevo para refrescarlos.
        </p>
      )}

      {failed ? (
        <Card>
          <CardHeader>
            <CardTitle>No pudimos completar esta búsqueda</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              La última ejecución falló
              {execution.finished_at
                ? ` el ${new Date(execution.finished_at).toLocaleDateString("es-ES")}`
                : ""}
              , así que no hay precios que mostrar. No hemos inventado datos.
            </p>
            {execution.error_message && (
              <p className="rounded-lg bg-muted px-3 py-2 font-mono text-xs">
                {execution.error_message}
              </p>
            )}
            <p>
              Vuelve a ejecutarla desde{" "}
              <Link className="font-semibold text-brand underline" href="/dashboard#searches">
                Mis búsquedas
              </Link>
              . Si el error se repite, revisaremos el scraper.
            </p>
          </CardContent>
        </Card>
      ) : allRows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No hemos encontrado vuelos para esta búsqueda</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Prueba con fechas más flexibles o un destino diferente.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_240px]">
          <div className="flex flex-col gap-4">
            {rows.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Ninguna opción cumple los filtros.{" "}
                  <Link
                    className="font-semibold text-brand underline"
                    href={`/searches/${id}`}
                  >
                    Quitar filtros
                  </Link>
                </CardContent>
              </Card>
            ) : (
              rows.map((option) => (
                <FlightDealCard
                  key={option.id}
                  deal={{
                    id: option.id,
                    price: Number(option.price_eur),
                    currency: option.currency,
                    outboundLegs: option.outbound_legs,
                    inboundLegs: option.inbound_legs,
                    bookingUrl,
                  }}
                  isBestPrice={Number(option.price_eur) === bestPrice}
                />
              ))
            )}
          </div>

          <aside className="lg:sticky lg:top-20 lg:self-start">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Filtrar resultados</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Precio máximo ({currency})
                    <input
                      className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                      defaultValue={filters.maxPrice ?? ""}
                      min={0}
                      name="precio"
                      placeholder="sin límite"
                      step="0.01"
                      type="number"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Duración máxima (min)
                    <input
                      className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                      defaultValue={filters.maxDuration ?? ""}
                      min={0}
                      name="dur"
                      placeholder="sin límite"
                      type="number"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input name="directo" type="checkbox" value="1" defaultChecked={filters.nonStopOnly} />
                    Solo directos
                  </label>
                  {airlines.length > 1 && (
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                      Aerolínea
                      <select
                        className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                        defaultValue={filters.airline ?? ""}
                        name="aerolinea"
                      >
                        <option value="">Todas</option>
                        {airlines.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Ordenar por
                    <select
                      className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                      defaultValue={filters.sort}
                      name="ord"
                    >
                      <option value="price">Precio</option>
                      <option value="duration">Duración</option>
                      <option value="stops">Escalas</option>
                    </select>
                  </label>
                  <Button size="sm" type="submit">
                    Aplicar
                  </Button>
                  {filtered && (
                    <Link
                      className="text-center text-xs text-muted-foreground underline"
                      href={`/searches/${id}`}
                    >
                      Quitar filtros
                    </Link>
                  )}
                  {rows.length !== allRows.length && (
                    <p className="text-xs text-muted-foreground">
                      {rows.length} de {allRows.length} opciones
                    </p>
                  )}
                </form>
              </CardContent>
            </Card>
          </aside>
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
            <PriceHistory
              stats={statsRows}
              currency={currency}
              currentPrice={rows[0]?.price_eur ?? null}
            />
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