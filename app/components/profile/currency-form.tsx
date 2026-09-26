"use client";

import { useActionState } from "react";

import {
  updateProfileCurrency,
  type ProfileState,
} from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const CURRENCIES = ["EUR", "USD", "GBP", "JPY", "BRL", "MXN", "ARS"];

const emptyState: ProfileState = {};

export function CurrencyForm({ current }: { current: string }) {
  const [state, formAction, pending] = useActionState(
    updateProfileCurrency,
    emptyState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <Label htmlFor="currency">Moneda</Label>
      <div className="flex items-end gap-2">
        <select
          id="currency"
          name="currency"
          defaultValue={current}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}