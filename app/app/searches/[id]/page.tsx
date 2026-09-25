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
    </main>
  );
}