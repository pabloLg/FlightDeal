"use client";

import { useCallback, useEffect, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  createSearch,
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
  searches: (SearchRow & { lastExecution: ExecutionRow | null })[];
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
    return (
      <div className="flex flex-col gap-4">
        <EmptyState />
        <CreateSearchCard />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <CreateSearchCard />
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
                <CardTitle>
                  {search.origin} → {search.destination}
                </CardTitle>
                <div className="flex items-center gap-2">
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
                </div>
              </div>
              <CardDescription>
                {[search.depart_date, search.return_date].filter(Boolean).join(" → ") || "Fechas flexibles"}{" "}
                · {search.trip_type === "one_way" ? "solo ida" : "ida y vuelta"} ·{" "}
                {search.cabin_class} · {search.adults} pax ·{" "}
                {search.stops === "non_stop" ? "sin escalas" : "cualquier escala"}
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

function CreateSearchCard() {
  const [state, formAction, pending] = useActionState(createSearch, emptyState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva búsqueda</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="origin">Origen</Label>
            <Input id="origin" name="origin" placeholder="MAD" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="destination">Destino</Label>
            <Input id="destination" name="destination" placeholder="BCN" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="depart_date">Salida</Label>
            <Input id="depart_date" name="depart_date" type="date" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="return_date">Regreso</Label>
            <Input id="return_date" name="return_date" type="date" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="trip_type">Tipo</Label>
            <select
              id="trip_type"
              name="trip_type"
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              defaultValue="round_trip"
            >
              <option value="round_trip">Ida y vuelta</option>
              <option value="one_way">Solo ida</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="adults">Pasajeros</Label>
            <Input id="adults" name="adults" type="number" min={1} max={9} defaultValue={1} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="alert_threshold_eur">Umbral de alerta (EUR)</Label>
            <Input
              id="alert_threshold_eur"
              name="alert_threshold_eur"
              type="number"
              min={0}
              step="0.01"
              placeholder="Opcional"
            />
          </div>
          <div className="flex flex-col justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear búsqueda"}
            </Button>
          </div>
          {state?.error && (
            <p className="text-sm text-destructive sm:col-span-2 lg:col-span-4" role="alert">
              {state.error}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

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