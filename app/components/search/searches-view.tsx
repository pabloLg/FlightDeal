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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Bell, Plane } from "lucide-react";
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

const DEGRADED_HELP =
  "Búsqueda degradada: una o más fuentes de precios fallaron, así que puede faltar algún resultado. Los precios que ves son los que sí se pudieron observar.";

function StatusPill({ status }: { status: string }) {
  const degraded = status === "degraded";
  return (
    <Badge
      variant={
        degraded ? "warn" : status === "failed" ? "danger" : "ok"
      }
      dot
      title={degraded ? DEGRADED_HELP : undefined}
    >
      {statusLabel(status)}
    </Badge>
  );
}

export function SearchesView({
  searches,
  currency,
}: {
  searches: (SearchRow & {
    lastExecution: ExecutionRow | null;
    /** Cheapest observed option, with the currency it was quoted in. */
    bestPrice: { price: number; currency: string } | null;
  })[];
  /** Profile currency, used only for the alert threshold label. */
  currency: string;
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
      {runningId !== null && (
        <p className="rounded-lg bg-sky px-3 py-2 text-sm text-brand-dark">
          Buscando precios en todas las fuentes. La primera ejecución en frío
          puede tardar hasta unos 30 s; los precios que ves siguen siendo los
          últimos observados.
        </p>
      )}
      <div className="grid gap-4">
        {searches.map((search) => {
          const liveStatus =
            runningId === search.id
              ? (pollStatus[search.id] ?? "running")
              : (search.lastExecution?.status ?? null);
          const threshold = search.alert_threshold_eur;
          const reached =
            threshold != null &&
            search.bestPrice != null &&
            search.bestPrice.price <= threshold;
          // Only this card's own actions are blocked by its own run. A run on
          // another route must not disable the whole list, which used to make
          // the dashboard feel frozen for a minute.
          const thisRunning = runningId === search.id;
          const anyRunning = runningId !== null;

          return (
            <Card key={search.id} size="sm">
              <div className="grid items-center gap-4 px-4 py-4 sm:grid-cols-[1.5fr_1.1fr_auto]">
                <div>
                  <div className="text-base font-extrabold text-brand-dark">
                    {search.origin} → {search.destination}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {[
                      search.depart_date,
                      search.return_date,
                    ].filter(Boolean).join(" → ") || "Fechas flexibles"}{" "}
                    · {search.trip_type === "one_way" ? "solo ida" : "ida y vuelta"} ·{" "}
                    {search.cabin_class} · {search.adults} pax ·{" "}
                    {search.stops === "non_stop" ? "sin escalas" : "cualquier escala"}
                    {search.date_flex_days > 0 &&
                      ` · ±${search.date_flex_days} días flexibles`}
                  </div>
                  {threshold != null && (
                    <p className="mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-full bg-sky px-2.5 py-1 text-xs text-brand-dark">
                      <Bell className="size-3.5" aria-hidden />
                      Avisarme por debajo de {threshold.toFixed(0)} {currency}
                      {reached && (
                        <span className="font-bold text-savings">
                          · precio alcanzado
                        </span>
                      )}
                      {!search.enabled && (
                        <span className="text-muted-foreground">
                          · alerta en pausa
                        </span>
                      )}
                    </p>
                  )}
                </div>

                <div className="flex flex-col items-start gap-1.5 sm:items-start">
                  {search.bestPrice != null ? (
                    <>
                      <span className="text-sm font-extrabold text-brand-dark">
                        Desde {search.bestPrice.price.toFixed(2)}{" "}
                        {search.bestPrice.currency}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Mejor precio observado
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Todavía sin precios
                    </span>
                  )}
                  {liveStatus ? (
                    <StatusPill status={liveStatus} />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Sin ejecutar
                    </span>
                  )}
                  {!search.enabled && (
                    <span className="text-xs text-muted-foreground">
                      Búsqueda desactivada
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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
                    disabled={thisRunning}
                    onClick={() =>
                      setEditingId(editingId === search.id ? null : search.id)
                    }
                  >
                    {editingId === search.id ? "Cerrar" : "Editar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={thisRunning}
                    onClick={() => onToggle(search.id, !search.enabled)}
                  >
                    {search.enabled ? "Desactivar" : "Activar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={thisRunning}
                    onClick={() => onDelete(search.id)}
                  >
                    Eliminar
                  </Button>
                  <Button
                    size="sm"
                    disabled={anyRunning || !search.enabled}
                    onClick={() => runSearch(search.id)}
                  >
                    {thisRunning ? "Ejecutando…" : "Ejecutar"}
                  </Button>
                </div>
              </div>

              {editingId === search.id && (
                <CardContent>
                  <EditSearchForm
                    search={search}
                    busy={runningId !== null}
                    onDone={() => {
                      setEditingId(null);
                      router.refresh();
                    }}
                  />
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <Plane className="size-8 text-brand/60" aria-hidden />
        <p className="font-semibold text-brand-dark">
          ☁️ Estamos esperando tus primeros resultados
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          Crea tu primera búsqueda de vuelos en el formulario de arriba para
          empezar a monitorizar precios.
        </p>
      </CardContent>
    </Card>
  );
}

const emptyState: SearchFormState = {};

type SearchWithExecution = SearchRow & { lastExecution: ExecutionRow | null };

function EditSearchForm({
  search,
  busy,
  onDone,
}: {
  search: SearchWithExecution;
  busy: boolean;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    updateSearch.bind(null, search.id),
    emptyState,
  );
  const [roundTrip, setRoundTrip] = useState(search.trip_type === "round_trip");

  useEffect(() => {
    if (state !== emptyState && !("error" in state) && !pending) {
      onDone();
    }
  }, [state, pending, onDone]);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`origin-${search.id}`}>Origen</Label>
        <Input
          id={`origin-${search.id}`}
          name="origin"
          maxLength={3}
          required
          defaultValue={search.origin}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`destination-${search.id}`}>Destino</Label>
        <Input
          id={`destination-${search.id}`}
          name="destination"
          maxLength={3}
          required
          defaultValue={search.destination}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`depart-${search.id}`}>Salida</Label>
        <Input
          id={`depart-${search.id}`}
          name="depart_date"
          type="date"
          defaultValue={search.depart_date ?? ""}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`return-${search.id}`}>Regreso</Label>
        <Input
          id={`return-${search.id}`}
          name="return_date"
          type="date"
          disabled={!roundTrip}
          defaultValue={search.return_date ?? ""}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`cabin-${search.id}`}>Cabina</Label>
        <select
          id={`cabin-${search.id}`}
          name="cabin_class"
          className="field-control h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          defaultValue={search.cabin_class}
        >
          <option value="economy">Económica</option>
          <option value="premium_economy">Premium economy</option>
          <option value="business">Business</option>
          <option value="first">Primera</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`stops-${search.id}`}>Escalas</Label>
        <select
          id={`stops-${search.id}`}
          name="stops"
          className="field-control h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          defaultValue={search.stops}
        >
          <option value="any">Cualquiera</option>
          <option value="non_stop">Solo directos</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`adults-${search.id}`}>Pasajeros</Label>
        <Input
          id={`adults-${search.id}`}
          name="adults"
          type="number"
          min={1}
          max={9}
          defaultValue={search.adults}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`flex-${search.id}`}>Flexibilidad (± días)</Label>
        <Input
          id={`flex-${search.id}`}
          name="date_flex_days"
          type="number"
          min={0}
          max={21}
          defaultValue={search.date_flex_days}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`alert-${search.id}`}>Avisarme por debajo de</Label>
        <div className="flex items-center gap-2">
          <Input
            id={`alert-${search.id}`}
            name="alert_threshold_eur"
            type="number"
            min={0}
            step="0.01"
            placeholder="sin umbral"
            defaultValue={search.alert_threshold_eur ?? ""}
          />
          <span className="text-sm text-muted-foreground">EUR</span>
        </div>
      </div>

      <div className="flex items-end gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={roundTrip}
            onChange={(e) => setRoundTrip(e.target.checked)}
            type="checkbox"
          />
          Ida y vuelta
        </label>
      </div>
      <input
        name="trip_type"
        type="hidden"
        value={roundTrip ? "round_trip" : "one_way"}
      />

      <div className="flex items-end sm:col-span-2 lg:col-span-4">
        <Button type="submit" size="sm" disabled={pending || busy}>
          Guardar
        </Button>
      </div>
      {state?.error && (
        <p className="text-sm text-destructive sm:col-span-2 lg:col-span-4" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}