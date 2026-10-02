"use client";

import { useActionState } from "react";

import { createSearch, type SearchFormState } from "@/app/actions/search";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const emptyState: SearchFormState = {};

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm";

export function SearchForm() {
  const [state, formAction, pending] = useActionState(createSearch, emptyState);

  return (
    <Card className="ring-brand/15 shadow-card">
      <CardHeader>
        <CardTitle className="text-base">Nueva búsqueda</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          action={formAction}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
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
              className={selectClass}
              defaultValue="round_trip"
            >
              <option value="round_trip">Ida y vuelta</option>
              <option value="one_way">Solo ida</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="adults">Pasajeros</Label>
            <Input
              id="adults"
              name="adults"
              type="number"
              min={1}
              max={9}
              defaultValue={1}
            />
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="date_flex_days">Flexibilidad (± días)</Label>
            <Input
              id="date_flex_days"
              name="date_flex_days"
              type="number"
              min={0}
              max={21}
              defaultValue={0}
              placeholder="0 = fechas exactas"
            />
          </div>
          <div className="flex flex-col justify-end">
            <Button type="submit" className="h-9" disabled={pending}>
              {pending ? "Creando…" : "Buscar vuelos"}
            </Button>
          </div>
          {state?.error && (
            <p
              className="text-sm text-destructive sm:col-span-2 lg:col-span-4"
              role="alert"
            >
              {state.error}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
