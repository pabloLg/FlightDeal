"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "cn";

import {
  buildTrends,
  filterRoutes,
  sortRoutes,
  summarize,
  type RouteSort,
  type RouteTrend,
  type SearchLike,
  type StatLike,
  type TrendPeriod,
} from "@/src/domain/trends/summary";

const PERIODS: { value: TrendPeriod; label: string }[] = [
  { value: "7", label: "7 días" },
  { value: "30", label: "30 días" },
  { value: "all", label: "Todo" },
];

const money = (n: number) =>
  n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Date-only strings: pin the parse to UTC so the label never slips a day.
const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });

const fmtCheck = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function Stat({ label, value, foot }: { label: string; value: string; foot: string }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/10">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-extrabold tracking-tight text-ink tabular-nums">
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{foot}</div>
    </div>
  );
}

// Plain SVG of the observed daily minimums: the only points drawn are the ones
// that were actually stored. With fewer than two days there is nothing to
// connect, so the card says so instead of drawing a flat or interpolated line.
function Sparkline({ days }: { days: { date: string; min: number }[] }) {
  if (days.length < 2) {
    return (
      <p className="rounded-lg bg-sky px-3 py-3 text-xs text-muted-foreground">
        Histórico insuficiente para mostrar la evolución.
      </p>
    );
  }
  const w = 300;
  const xs = (i: number) => 12 + (i * (w - 24)) / (days.length - 1);
  const mn = Math.min(...days.map((d) => d.min));
  const mx = Math.max(...days.map((d) => d.min));
  const range = mx - mn || 1;
  const ys = (v: number) => 8 + ((mx - v) / range) * 44;
  const pts = days.map((d, i) => `${xs(i)},${ys(d.min)}`).join(" ");

  return (
    <svg
      className="h-16 w-full"
      viewBox={`0 0 ${w} 60`}
      role="img"
      aria-label="Evolución del mínimo diario observado, en EUR"
    >
      {[16, 38, 60].map((y) => (
        <line
          key={y}
          x1="5"
          x2="295"
          y1={y}
          y2={y}
          stroke="var(--border)"
          strokeDasharray="3 4"
        />
      ))}
      <polyline
        points={pts}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {days.map((d, i) => (
        <circle key={d.date} cx={xs(i)} cy={ys(d.min)} r="3" fill="var(--brand)" />
      ))}
    </svg>
  );
}

function ChangeBadge({ change }: { change: number | null }) {
  const title = "Variación del mínimo diario observado, no del mismo vuelo";
  if (change === null) {
    return (
      <Badge variant="neutral" title="Hacen falta dos días con observaciones comparables">
        Datos limitados
      </Badge>
    );
  }
  if (change < 0) return <Badge variant="ok" title={title}>↓ {Math.abs(change).toFixed(0)}%</Badge>;
  if (change > 0) return <Badge variant="warn" title={title}>↑ {change.toFixed(0)}%</Badge>;
  return <Badge variant="neutral" title={title}>0%</Badge>;
}

function RouteCard({
  route,
  cities,
}: {
  route: RouteTrend;
  cities: Record<string, string>;
}) {
  const { search, days, minPeriod, lastMin, change, lastCheckAt } = route;
  const cityFrom = cities[search.origin] ?? search.origin;
  const cityTo = cities[search.destination] ?? search.destination;
  const trip = search.trip_type === "one_way" ? "solo ida" : "ida y vuelta";
  const dates = search.depart_date
    ? `${fmtDay(search.depart_date)}${
        search.return_date ? ` – ${fmtDay(search.return_date)}` : ""
      }`
    : "sin fecha fija";
  const flex = search.date_flex_days > 0 ? ` · ±${search.date_flex_days} días` : "";
  const lastTone =
    change !== null && change < 0
      ? "text-savings"
      : change !== null && change > 0
        ? "text-opportunity"
        : "text-ink";

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <div className="text-lg font-extrabold tracking-tight text-brand-dark">
            {search.origin} → {search.destination}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {cityFrom} → {cityTo}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {dates} · {trip}
            {flex}
          </div>
        </div>
        <ChangeBadge change={change} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-3">
        <div>
          <div className="text-2xl font-extrabold tracking-tight text-brand-dark tabular-nums">
            {money(minPeriod)} <span className="text-sm font-semibold">EUR</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Mínimo observado del período
          </div>
        </div>
        <div className="text-right">
          <div className={cn("text-lg font-bold tabular-nums", lastTone)}>
            {money(lastMin)} €
          </div>
          <div className="text-xs text-muted-foreground">Último mínimo diario</div>
        </div>
      </div>

      <div className="px-4 pt-2">
        <Sparkline days={days} />
      </div>
      <div className="flex items-center justify-between px-4 pb-2 text-xs text-muted-foreground">
        <span>{fmtDay(days[0].date)}</span>
        <span>{fmtDay(days[days.length - 1].date)}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <span>
          {lastCheckAt
            ? `Última comprobación: ${fmtCheck(lastCheckAt)}`
            : "Sin comprobaciones registradas"}
        </span>
        <Link
          href={`/searches/${search.id}`}
          className="font-semibold text-brand hover:underline"
        >
          Ver búsqueda →
        </Link>
      </div>
    </article>
  );
}

export function TrendsView({
  searches,
  stats,
  lastCheckBySearch,
  cities,
  currency,
  today,
}: {
  searches: SearchLike[];
  stats: StatLike[];
  lastCheckBySearch: Record<string, string | null>;
  cities: Record<string, string>;
  currency: string;
  today: string;
}) {
  const [period, setPeriod] = useState<TrendPeriod>("7");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [sort, setSort] = useState<RouteSort>("min");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const allRoutes = useMemo(
    () => buildTrends(searches, stats, lastCheckBySearch, { period, today }),
    [searches, stats, lastCheckBySearch, period, today],
  );
  const routes = useMemo(
    () => sortRoutes(filterRoutes(allRoutes, { origin, destination }), sort),
    [allRoutes, origin, destination, sort],
  );
  const indicators = useMemo(() => summarize(routes), [routes]);

  const origins = useMemo(
    () => [...new Set(searches.map((s) => s.origin))].sort(),
    [searches],
  );
  const destinations = useMemo(
    () => [...new Set(searches.map((s) => s.destination))].sort(),
    [searches],
  );
  const hasFilters = origin !== "" || destination !== "";
  const clearFilters = () => {
    setOrigin("");
    setDestination("");
  };

  return (
    <main className="mx-auto flex w-full max-w-[1420px] flex-col gap-8 px-6 pb-16">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">
            FlightDeal · Tu radar de viajes
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-brand-dark">
            Tendencias de precios
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Descubre cómo evolucionan los precios de las rutas que sigues.
          </p>
        </div>
        <div
          role="group"
          aria-label="Período"
          className="flex gap-1 rounded-xl bg-card p-1 ring-1 ring-foreground/10"
        >
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={period === p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "min-h-9 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                period === p.value
                  ? "bg-sky-2 text-brand-dark"
                  : "text-muted-foreground hover:text-brand-dark",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {allRoutes.length === 0 ? (
        <EmptyState
          title="Todavía no hay histórico"
          body="Ejecuta una búsqueda para empezar a registrar mínimos diarios por ruta."
          action={
            <Link
              className="text-sm font-semibold text-brand underline"
              href="/dashboard#searches"
            >
              Ver mis búsquedas
            </Link>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-6">
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat
                label="Rutas con datos"
                value={String(indicators.routeCount)}
                foot="Rutas únicas en la selección"
              />
              <Stat
                label="Precio mínimo observado"
                value={indicators.minPrice != null ? `${money(indicators.minPrice)} €` : "—"}
                foot="Entre tus búsquedas filtradas"
              />
              <Stat
                label="Rutas con bajada"
                value={String(indicators.dropCount)}
                foot="Solo con datos comparables"
              />
            </section>

            {currency !== "EUR" ? (
              <p className="text-xs text-muted-foreground">Histórico disponible en EUR.</p>
            ) : null}

            <section className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-brand-dark">Evolución por ruta</h2>
                  <p className="text-xs text-muted-foreground">
                    Mínimo diario observado, último valor y variación del período.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Ordenar por
                  <select
                    className="field-control rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as RouteSort)}
                  >
                    <option value="min">Precio mínimo</option>
                    <option value="drop">Mayor bajada</option>
                    <option value="recent">Última actualización</option>
                  </select>
                </label>
              </div>

              {routes.length === 0 ? (
                <EmptyState
                  title="Ninguna ruta cumple los filtros"
                  body="Prueba a quitar el origen o el destino."
                  action={
                    <button
                      type="button"
                      className="text-sm font-semibold text-brand underline"
                      onClick={clearFilters}
                    >
                      Quitar filtros
                    </button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {routes.map((route) => (
                    <RouteCard key={route.search.id} route={route} cities={cities} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="flex h-fit flex-col gap-4 lg:sticky lg:top-20">
            <section className="rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/10">
              <button
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((open) => !open)}
                className="flex w-full items-center justify-between text-sm font-semibold text-brand-dark focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:cursor-default"
              >
                Filtrar rutas
                <span className="text-muted-foreground lg:hidden">
                  {filtersOpen ? "−" : "+"}
                </span>
              </button>
              <div className={cn("mt-3 flex-col gap-3", filtersOpen ? "flex" : "hidden lg:flex")}>
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  Origen
                  <select
                    className="field-control rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
                  >
                    <option value="">Todos</option>
                    {origins.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  Destino
                  <select
                    className="field-control rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                  >
                    <option value="">Todos</option>
                    {destinations.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>
                {hasFilters ? (
                  <button
                    type="button"
                    className="text-left text-xs text-muted-foreground underline"
                    onClick={clearFilters}
                  >
                    Quitar filtros
                  </button>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl bg-card p-4 text-xs text-muted-foreground shadow-soft ring-1 ring-foreground/10">
              <h2 className="text-sm font-semibold text-brand-dark">
                Cómo leer las tendencias
              </h2>
              <p className="mt-2">
                La variación solo aparece cuando la misma búsqueda tiene al menos
                dos días con observaciones comparables. Una bajada describe el
                mínimo diario que se registró: no garantiza que ese precio siga
                disponible ni que corresponda al mismo vuelo.
              </p>
              <p className="mt-2">
                No se inventan valores entre observaciones y todo el histórico está
                en EUR.
              </p>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}
