"use client";

import { useCallback, useEffect, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  deleteSearch,
  toggleSearch,
  updateSearch,
  type SearchFormState,
} from "@/app/actions/search";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SearchRow = {
  id: string;
  origin: string;
  destination: string;
  depart_date: string | null;
  return_date: string | null;
  trip_type: "round_trip" | "one_way";
  cabin_class: "economy" | "premium_economy" | "business" | "first";
  stops: "any" | "non_stop";
  adults: number;
  enabled: boolean;
  alert_threshold_eur: number | null;
  date_flex_days: number;
};

type ExecutionRow = {
  id: string;
  status: string;
  finished_at: string | null;
  created_at: string;
};

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "En cola";
    case "running":
      return "Ejecutando…";
    case "completed":
      return "Completada";
    case "degraded":
      return "Degradada";
    case "failed":
      return "Fallida";
    default:
      return status;
  }
}

export function SearchesView({
  searches,
}: {
  searches: (SearchRow & {
    lastExecution: ExecutionRow | null;
    bestPrice: number | null;
  })[];
}) {
  const router = useRouter();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [pollStatus, setPollStatus] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const runSearch = useCallback(
    async (searchId: string) => {
      setRunningId(searchId);
      setError(null);
      try {
        const res = await fetch(`/api/searches/${searchId}`, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error ?? "No se pudo iniciar la búsqueda");
          setRunningId(null);
          return;
        }
        const { executionId } = await res.json();

        for (let i = 0; i < 60; i++) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          const status = await fetch(`/api/searches/${searchId}`);
          if (!status.ok) continue;
          const { execution } = await status.json();
          setPollStatus((prev) => ({
            ...prev,
            [searchId]: execution.status,
          }));
          if (execution.id !== executionId) break;
          if (["completed", "degraded", "failed"].includes(execution.status)) break;
        }
      } finally {
        setRunningId(null);
        router.refresh();
      }
    },
    [router],
  );

  const onDelete = async (id: string) => {
    await deleteSearch(id);
    router.refresh();
  };

  const onToggle = async (id: string, enabled: boolean) => {
    await toggleSearch(id, enabled);
    router.refresh();
  };

  if (searches.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="grid gap-4">
        {searches.map((search) => (
          <Card key={search.id} size="sm">
            <CardHeader>
<div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base font-extrabold text-brand-dark">
                    {search.origin} → {search.destination}
                  </CardTitle>
                  <div className="flex items-center gap-3">
                    {search.bestPrice != null && (
                      <span className="text-sm font-semibold text-brand-dark">
                        Desde {search.bestPrice.toFixed(2)} EUR
                      </span>
                    )}
                    {runningId === search.id && (
                      <span className="text-sm text-muted-foreground">
                        {statusLabel(pollStatus[search.id] ?? "running")}
                      </span>
                    )}
                    {search.lastExecution && runningId !== search.id && (
                      <span className="text-sm text-muted-foreground">
                        {statusLabel(search.lastExecution.status)}
                      </span>
                    )}
                    {!search.lastExecution && runningId !== search.id && (
                      <span className="text-sm text-muted-foreground">Sin ejecutar</span>
                    )}
                    {/* Alert display */}
                    {search.alert_threshold_eur != null && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-opportunity">
                        <span>
                          🔔 Avisarme cuando sea inferior a {search.alert_threshold_eur.toFixed(0)} €
                        </span>
                        {search.bestPrice != null && search.bestPrice <= search.alert_threshold_eur && (
                          <span className="font-medium">⚠️ Activa</span>
                        )}
                        {search.bestPrice != null && search.bestPrice > search.alert_threshold_eur && (
                          <span>—</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              <CardDescription>
                {[search.depart_date, search.return_date].filter(Boolean).join(" → ") || "Fechas flexibles"}{" "}
                · {search.trip_type === "one_way" ? "solo ida" : "ida y vuelta"} ·{" "}
                {search.cabin_class} · {search.adults} pax ·{" "}
                {search.stops === "non_stop" ? "sin escalas" : "cualquier escala"}
                {search.date_flex_days > 0 &&
                  ` · ±${search.date_flex_days} días flexibles`}
              </CardDescription>
              {!search.enabled && (
                <CardDescription>Desactivada</CardDescription>
              )}
            </CardHeader>
            {editingId === search.id && (
              <CardContent>
                <EditSearchForm
                  search={search}
                  onDone={() => {
                    setEditingId(null);
                    router.refresh();
                  }}
                />
              </CardContent>
            )}
            <CardAction>
              <div className="flex items-center gap-2">
                {search.lastExecution && (
                  <Button
                    size="sm"
                    variant="outline"
                    render={<Link href={`/searches/${search.id}`} />}
                  >
                    Ver resultados
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={runningId !== null}
                  onClick={() => setEditingId(editingId === search.id ? null : search.id)}
                >
                  {editingId === search.id ? "Cerrar" : "Editar"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={runningId !== null}
                  onClick={() => onToggle(search.id, !search.enabled)}
                >
                  {search.enabled ? "Desactivar" : "Activar"}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onDelete(search.id)}
                >
                  Eliminar
                </Button>
                <Button
                  size="sm"
                  disabled={runningId !== null || !search.enabled}
                  onClick={() => runSearch(search.id)}
                >
                  {runningId === search.id ? "Ejecutando…" : "Ejecutar"}
                </Button>
              </div>
            </CardAction>
          </Card>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sin búsquedas todavía</CardTitle>
        <CardDescription>
          Crea tu primera búsqueda de vuelos para empezar a monitorizar precios.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

const emptyState: SearchFormState = {};

type SearchWithExecution = SearchRow & { lastExecution: ExecutionRow | null };

function EditSearchForm({
  search,
  onDone,
}: {
  search: SearchWithExecution;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    updateSearch.bind(null, search.id),
    emptyState,
  );

  useEffect(() => {
    if (state !== emptyState && !("error" in state) && !pending) {
      onDone();
    }
  }, [state, pending, onDone]);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-4">
      <Label htmlFor={`origin-${search.id}`} className="sr-only">
        Origen
      </Label>
      <Input id={`origin-${search.id}`} name="origin" defaultValue={search.origin} />
      <Label htmlFor={`destination-${search.id}`} className="sr-only">
        Destino
      </Label>
      <Input
        id={`destination-${search.id}`}
        name="destination"
        defaultValue={search.destination}
      />
      <Label htmlFor={`depart-${search.id}`} className="sr-only">
        Salida
      </Label>
      <Input
        id={`depart-${search.id}`}
        name="depart_date"
        type="date"
        defaultValue={search.depart_date ?? ""}
      />
      <Label htmlFor={`return-${search.id}`} className="sr-only">
        Regreso
      </Label>
      <Input
        id={`return-${search.id}`}
        name="return_date"
        type="date"
        defaultValue={search.return_date ?? ""}
      />
      <Input name="trip_type" type="hidden" value={search.trip_type} />
      <Input name="cabin_class" type="hidden" value={search.cabin_class} />
      <Input name="stops" type="hidden" value={search.stops} />
      <Input name="adults" type="hidden" value={search.adults} />
      <Label htmlFor={`flex-${search.id}`} className="sr-only">
        Flexibilidad (± días)
      </Label>
      <Input
        id={`flex-${search.id}`}
        name="date_flex_days"
        type="number"
        min={0}
        max={21}
        placeholder="±días flex"
        defaultValue={search.date_flex_days}
      />
      <Label htmlFor={`alert-${search.id}`} className="sr-only">
        Umbral de alerta (EUR)
      </Label>
      <Input
        id={`alert-${search.id}`}
        name="alert_threshold_eur"
        type="number"
        min={0}
        step="0.01"
        placeholder="Umbral (EUR)"
        defaultValue={search.alert_threshold_eur ?? ""}
      />
      <Button type="submit" size="sm" disabled={pending}>
        Guardar
      </Button>
      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}