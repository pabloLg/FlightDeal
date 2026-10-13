import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AlertHistory, PriceHistory, type DispatchRow, type PriceStatRow } from "@/components/deals/price-history";
import { FlightDealCard } from "@/components/deals/flight-deal-card";
import { SearchCalendar } from "@/components/deals/search-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPanel } from "@/components/ui/filter-panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { createClient } from "@/lib/supabase/server";
import { buildBookingUrl } from "@/lib/flight-display";
import { cityMapFor } from "@/src/domain/sources/airports";
import { favoritesFirst } from "@/src/domain/deals/rank";
import { availableDatesOf, resolveDateView } from "@/src/domain/deals/date-view";
import { outboundDepartDate } from "@/src/domain/deals/date-window";
import {
  airlineOptions,
  applyFilters,
  parseFilters,
  type FlightOptionRow,
} from "@/src/domain/deals/filters";

// Which sources this execution actually asked, and why the others were not.
// Read from raw_result so the page can answer "why Google only?" honestly.
type SourceTrace = {
  used: string[];
  skipped: { source: string; reason: string }[];
  attempts: {
    source: string;
    degraded: boolean;
    ms: number;
    detail: string;
    included: boolean;
  }[];
};

type ExecutionRow = {
  id: string;
  status: string;
  finished_at: string | null;
  error_message: string | null;
  raw_result: unknown;
};

type OptionRow = FlightOptionRow & { execution_id: string };

const SOURCE_LABEL: Record<string, string> = {
  google_flights: "Google Flights",
  serpapi: "SerpAPI",
  ignav: "Ignav",
  mock: "Mock",
};

const SKIP_REASON: Record<string, string> = {
  missing_api_key: "sin clave configurada",
  unknown_source: "fuente desconocida",
  max_sources_per_run_reached: "límite de fuentes por ejecución",
  budget_exhausted: "presupuesto agotado",
  timeout_margin_exceeded: "sin tiempo para otra fuente",
  no_flights: "sin vuelos en esta fuente",
};

function readSourceTrace(raw: unknown): SourceTrace | null {
  if (typeof raw !== "object" || raw === null) return null;
  const result = raw as {
    skipped?: unknown;
    aggregation?: { sourcesIncluded?: unknown };
    attempts?: unknown;
  };
  const attemptsRaw = Array.isArray(result.attempts) ? result.attempts : [];
  const attempts = attemptsRaw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const a = entry as {
      sourceId?: unknown;
      degraded?: unknown;
      ms?: unknown;
      message?: unknown;
      included?: unknown;
    };
    if (typeof a.sourceId !== "string") return [];
    return [
      {
        source: SOURCE_LABEL[a.sourceId] ?? a.sourceId,
        degraded: a.degraded === true,
        ms: typeof a.ms === "number" ? a.ms : 0,
        detail: typeof a.message === "string" ? a.message : "",
        included: a.included === true,
      },
    ];
  });
  const skippedRaw = Array.isArray(result.skipped) ? result.skipped : [];
  const skipped = skippedRaw.flatMap((entry) => {
    if (typeof entry !== "string" || !entry.includes(":")) return [];
    const [source, reason] = entry.split(":");
    return [
      {
        source: SOURCE_LABEL[source] ?? source,
        reason: SKIP_REASON[reason] ?? reason,
      },
    ];
  });
  const included = Array.isArray(result.aggregation?.sourcesIncluded)
    ? (result.aggregation!.sourcesIncluded as unknown[])
    : [];
  const used = included.map((s) => SOURCE_LABEL[String(s)] ?? String(s));
  if (used.length === 0 && skipped.length === 0 && attempts.length === 0) return null;
  return { used, skipped, attempts };
}

function SourceTraceNote({ trace }: { trace: SourceTrace }) {
  return (
    <p className="text-xs text-muted-foreground">
      {trace.used.length > 0 ? (
        <>
          Fuentes consultadas:{" "}
          <span className="font-medium text-brand-dark">
            {trace.used.join(" · ")}
          </span>
          .
        </>
      ) : null}
      {trace.skipped.length > 0 ? (
        <>
          {" "}
          Sin consultar:{" "}
          {trace.skipped.map((s) => `${s.source} (${s.reason})`).join(", ")}.
        </>
      ) : null}{" "}
      Cada fuente usa las claves del dueño de la búsqueda.
      {trace.attempts.length > 0 ? (
        <>
          {" "}
          Detalle:{" "}
          {trace.attempts
            .map((a) => {
              const estado = a.degraded
                ? "degradada"
                : a.included
                  ? "con resultados"
                  : "sin resultados";
              const detalle = a.detail ? ` (${a.detail})` : "";
              return `${a.source}: ${estado}${detalle}, ${(a.ms / 1000).toFixed(1)}s`;
            })
            .join("; ")}
          .
        </>
      ) : null}
    </p>
  );
}

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Resultados | FlightDeal",
};

export default async function SearchResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: search, error: searchError } = await supabase
    .from("searches")
    .select(
      "id, origin, destination, depart_date, return_date, trip_type, cabin_class, stops, adults, alert_threshold_eur, date_flex_days",
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

  const { data: executions } = await supabase
    .from("search_executions")
    .select("id, status, finished_at, error_message, raw_result")
    .eq("search_id", id)
    .order("created_at", { ascending: false });
  const execList = (executions ?? []) as ExecutionRow[];
  if (execList.length === 0) notFound();
  const latest = execList[0];

  // Options belong to the search, not to a single run: the dedupe key embeds the
  // departure date, so every day the user has searched keeps its own rows.
  const { data: options } = await supabase
    .from("flight_options")
    .select(
      "id, execution_id, dedupe_key, price_eur, currency, outbound_legs, inbound_legs, airlines, total_duration_min, source_id, booking_links",
    )
    .eq("search_id", id)
    .order("price_eur", { ascending: true });
  const allOptions = (options ?? []) as OptionRow[];

  const availableDates = availableDatesOf(allOptions);
  const latestDate =
    outboundDepartDate(
      allOptions.find((o) => o.execution_id === latest.id)?.outbound_legs,
    ) ?? null;
  const requestedDate =
    typeof sp.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha)
      ? sp.fecha
      : null;
  const selectedDate =
    requestedDate ?? latestDate ?? search.depart_date ?? availableDates[0] ?? null;

  // Only the newest run that returned this date: a re-search never resurfaces
  // rows the latest run no longer offered.
  const { rows: allRows, executionId: displayExecId } = selectedDate
    ? resolveDateView(allOptions, execList, selectedDate)
    : { rows: [] as OptionRow[], executionId: null as string | null };
  const displayExec = execList.find((e) => e.id === displayExecId) ?? null;
  const headerExec = displayExec ?? latest;

  const filters = parseFilters(sp);

  const { data: favorites } = await supabase
    .from("favorite_deals")
    .select("dedupe_key")
    .eq("search_id", id);
  const favoriteKeys = new Set((favorites ?? []).map((f) => f.dedupe_key));

  // Favorites float to the front while keeping the user's chosen sort.
  const rows = favoritesFirst(
    applyFilters(allRows, filters).map((r) => ({
      ...r,
      isFavorite: favoriteKeys.has(r.dedupe_key),
    })),
  );

  // City names for every airport on this page, resolved once from the static
  // dataset.
  const codes = new Set<string>([search.origin, search.destination]);
  for (const opt of allRows) {
    for (const leg of [...opt.outbound_legs, ...opt.inbound_legs]) {
      codes.add(leg.departAirport);
      codes.add(leg.arriveAirport);
    }
  }
  const cities = cityMapFor(codes);
  const bestPrice = allRows.length > 0 ? Number(allRows[0].price_eur) : null;
  const filtered =
    filters.maxPrice != null ||
    filters.maxDuration != null ||
    filters.nonStopOnly ||
    filters.airline != null;
  const airlines = airlineOptions(allRows);
  const sourceTrace = readSourceTrace(headerExec.raw_result);
  const bookingUrl = buildBookingUrl({
    origin: search.origin,
    destination: search.destination,
    depart_date: selectedDate,
    return_date: search.return_date,
    trip_type: search.trip_type,
    cabin_class: search.cabin_class,
    stops: search.stops,
    adults: search.adults,
  });

  const selectedIsLatest = selectedDate != null && selectedDate === latestDate;
  const showFailed =
    !displayExec &&
    latest.status === "failed" &&
    (selectedDate == null || selectedIsLatest);
  const baseHref = selectedDate ? `/searches/${id}?fecha=${selectedDate}` : `/searches/${id}`;

  const { data: stats } = await supabase
    .from("price_stats_daily")
    .select("stats_date, min_price_eur, max_price_eur, avg_price_eur, observations")
    .eq("search_id", id)
    .order("stats_date", { ascending: true });

  const statsRows = (stats ?? []) as PriceStatRow[];

  // Only this search's dispatches: the alerts_edge join is filtered, so RLS
  // (which scopes by owner) is not enough on its own to scope by search.
  const { data: dispatches } = await supabase
    .from("alert_dispatches")
    .select(
      "id, price_eur, status, dispatched_at, alerts_edge!inner(threshold_eur, provider, search_id)",
    )
    .eq("alerts_edge.search_id", id)
    .order("dispatched_at", { ascending: false });

  const dispatchRows = (dispatches ?? []) as DispatchRow[];

  return (
    <main className="mx-auto flex w-full max-w-[1420px] flex-1 flex-col gap-6 px-6 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight text-brand-dark">
            {search.origin} → {search.destination}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {allRows.length} opciones · búsqueda completada el{" "}
            {headerExec.finished_at
              ? new Date(headerExec.finished_at).toLocaleDateString("es-ES")
              : "—"}
            {` · ${search.adults} pasajero${search.adults > 1 ? "s" : ""} · ${
              search.cabin_class === "economy" ? "economy" : search.cabin_class
            }`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <FreshnessChip checkedAt={headerExec.finished_at} />
            {search.alert_threshold_eur != null ? (
              <Badge variant="info">
                Alerta: avisar por debajo de{" "}
                {search.alert_threshold_eur.toFixed(0)} EUR
              </Badge>
            ) : null}
          </div>
          {sourceTrace ? (
            <div className="mt-2">
              <SourceTraceNote trace={sourceTrace} />
            </div>
          ) : null}
          {search.date_flex_days > 0 ? (
            <div className="mt-2">
              <p className="text-xs text-opportunity">
                Esta búsqueda tiene ±{search.date_flex_days} días de
                flexibilidad, así que solo se consulta Google Flights: SerpAPI e
                Ignav degradan a propósito para no buscar en silencio solo tus
                fechas exactas.
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/dashboard#searches" />}
          >
            Editar búsqueda
          </Button>
          <Button variant="ghost" render={<Link href="/dashboard" />}>
            Volver
          </Button>
        </div>
      </div>

      <SearchCalendar
        searchId={id}
        returnDate={search.return_date}
        selectedDate={selectedDate}
        availableDates={availableDates}
        executedAt={displayExec?.finished_at ?? null}
        hasResults={allRows.length > 0}
        executionFailed={showFailed}
      />

      {showFailed ? (
        <Card>
          <CardHeader>
            <CardTitle>No pudimos completar esta búsqueda</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              La última ejecución falló
              {latest.finished_at
                ? ` el ${new Date(latest.finished_at).toLocaleDateString("es-ES")}`
                : ""}
              , así que no hay precios que mostrar. No hemos inventado datos.
            </p>
            {latest.error_message && (
              <p className="rounded-lg bg-muted px-3 py-2 font-mono text-xs">
                {latest.error_message}
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
      ) : allRows.length === 0 ? null : (
        <div className="grid gap-4 lg:grid-cols-[1fr_240px] lg:gap-6">
          {/* Filters first in the source: above the cards on mobile, sticky
              beside them on desktop. */}
          <div className="order-first lg:order-last">
            <FilterPanel
              footer={
                <>
                  {filtered && (
                    <Link
                      className="text-center text-xs text-muted-foreground underline"
                      href={baseHref}
                    >
                      Quitar filtros
                    </Link>
                  )}
                </>
              }
            >
              <form className="flex flex-col gap-3">
                <input type="hidden" name="fecha" value={selectedDate ?? ""} />
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  Precio máximo ({currency})
                  <input
                    className="field-control h-8 rounded-lg border border-border bg-transparent px-2 text-sm"
                    defaultValue={filters.maxPrice ?? ""}
                    min={0}
                    name="precio"
                    placeholder="sin límite"
                    type="number"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  Duración máxima (min)
                  <input
                    className="field-control h-8 rounded-lg border border-border bg-transparent px-2 text-sm"
                    defaultValue={filters.maxDuration ?? ""}
                    min={0}
                    name="dur"
                    placeholder="sin límite"
                    type="number"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    name="directo"
                    type="checkbox"
                    value="1"
                    defaultChecked={filters.nonStopOnly}
                  />
                  Solo directos
                </label>
                {airlines.length > 1 && (
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Aerolínea
                    <select
                      className="field-control h-8 rounded-lg border border-border bg-transparent px-2 text-sm"
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
                    className="field-control h-8 rounded-lg border border-border bg-transparent px-2 text-sm"
                    defaultValue={filters.sort}
                    name="ord"
                  >
                    <option value="price">Más barato</option>
                    <option value="duration">Más rápido</option>
                    <option value="stops">Menos escalas</option>
                  </select>
                </label>
                <Button size="sm" type="submit">
                  Aplicar
                </Button>
              </form>
            </FilterPanel>
          </div>

          <div className="flex flex-col gap-4">
            {rows.length === 0 ? (
              <EmptyState
                title="Ninguna opción cumple los filtros"
                body="Prueba a ampliar el precio o la duración máxima."
                action={
                  <Link
                    className="text-sm font-semibold text-brand underline"
                    href={baseHref}
                  >
                    Quitar filtros
                  </Link>
                }
              />
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
                    source: option.source_id,
                    bookingLinks: option.booking_links,
                  }}
                  isBestPrice={Number(option.price_eur) === bestPrice}
                  cities={cities}
                  isFavorite={option.isFavorite}
                />
              ))
            )}
          </div>
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
              Aún no se ha disparado ninguna alerta para esta búsqueda.{" "}
              {search.alert_threshold_eur != null
                ? `Avisamos cuando el mejor precio baja de ${search.alert_threshold_eur.toFixed(0)} EUR.`
                : "Configura un umbral en Mis búsquedas para recibir avisos."}
            </p>
          ) : (
            <AlertHistory
              dispatches={dispatchRows}
              thresholdEur={search.alert_threshold_eur}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
