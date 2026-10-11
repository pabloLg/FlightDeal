"use client";

import { useActionState } from "react";
import { AlertCircle, Check, KeyRound, Trash2 } from "lucide-react";

import {
  clearSourceCredential,
  saveSourceCredential,
  testSourceConnection,
  type CredentialState,
} from "@/app/actions/source-credentials";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

const ORIGIN_LABEL: Record<"env" | "database" | "none", { label: string; variant: "ok" | "info" | "warn" }> = {
  env: { label: "Configurada por variable de entorno", variant: "ok" },
  database: { label: "Configurada en la aplicación", variant: "info" },
  none: { label: "Sin configurar", variant: "warn" },
};

const empty: CredentialState = {};

function SourceCard({
  provider,
  label,
  description,
  docsUrl,
  origin,
  hasStored,
  canTestConnection,
  testNote,
}: {
  provider: string;
  label: string;
  description: string;
  docsUrl: string;
  origin: "env" | "database" | "none";
  /** A row exists even when the environment variable wins over it. */
  hasStored: boolean;
  canTestConnection: boolean;
  testNote?: string;
}) {
  const [saveState, saveAction, saving] = useActionState(saveSourceCredential, empty);
  const [clearState, clearAction, clearing] = useActionState(clearSourceCredential, empty);
  const [testState, testAction, testing] = useActionState(testSourceConnection, empty);

  const status = ORIGIN_LABEL[origin];
  const message = saveState?.error ?? clearState?.error ?? testState?.error;
  const isTestOk = testState?.ok === true && !testState?.error;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-brand" aria-hidden />
            {label}
          </CardTitle>
          <Badge variant={status.variant} dot>
            {status.label}
          </Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form action={saveAction} className="flex flex-col gap-3">
          <input type="hidden" name="provider" value={provider} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`secret-${provider}`}>
              {origin === "database" ? "Sustituir credencial" : "Credencial"}
            </Label>
            <input
              className="field-control h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              id={`secret-${provider}`}
              name="secret"
              type="password"
              autoComplete="off"
              placeholder={
                origin === "env"
                  ? "La variable de entorno tiene prioridad"
                  : "Pega la clave aquí"
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
            {canTestConnection ? (
              <Button
                type="submit"
                size="sm"
                variant="outline"
                formAction={testAction}
                disabled={testing}
              >
                {testing ? "Comprobando…" : "Probar conexión"}
              </Button>
            ) : null}
          </div>
          {saveState?.ok ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-savings">
              <Check className="size-3.5" aria-hidden />
              Guardada.
            </p>
          ) : null}
        </form>

        {hasStored ? (
          <form action={clearAction} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <input type="hidden" name="provider" value={provider} />
            <Button
              type="submit"
              size="sm"
              variant="destructive"
              disabled={clearing}
            >
              <Trash2 className="size-3.5" aria-hidden />
              {clearing ? "Quitando…" : "Quitar la guardada"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {origin === "env"
                ? "Hay una credencial guardada, pero la variable de entorno tiene prioridad y es la que se usa."
                : "Vuelve a usar la variable de entorno, si existe."}
            </span>
          </form>
        ) : null}

        {isTestOk ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-savings">
            <Check className="size-3.5" aria-hidden />
            Conexión correcta.
          </p>
        ) : null}
        {message ? (
          <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {message}
          </p>
        ) : null}
        {!canTestConnection && testNote ? (
          <p className="text-xs text-muted-foreground">{testNote}</p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Consigue la clave en{" "}
          <a
            className="font-semibold text-brand underline"
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {docsUrl.replace("https://", "")}
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}

export function SourceCredentials({
  statuses,
}: {
  statuses: {
    provider: string;
    origin: "env" | "database" | "none";
    hasStored: boolean;
  }[];
}) {
  if (statuses.length === 0) return null;
  const entryOf = (provider: string) => statuses.find((s) => s.provider === provider);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SourceCard
        provider="serpapi"
        label="SerpAPI"
        description="Motor google_flights de SerpAPI. Cada búsqueda consume cuota (250/mes en el plan gratuito)."
        docsUrl="https://serpapi.com/dashboard"
        origin={entryOf("serpapi")?.origin ?? "none"}
        hasStored={entryOf("serpapi")?.hasStored ?? false}
        canTestConnection={false}
        testNote="Verificar consume cuota: cualquier llamada gasta una búsqueda. Si guardas la clave y una ejecución devuelve resultados, está correcta."
      />
      <SourceCard
        provider="ignav"
        label="Ignav"
        description="API de tarifas de Ignav. Devuelve ida y vuelta en la misma respuesta y tiene enlaces de reserva."
        docsUrl="https://ignav.com/dashboard"
        origin={entryOf("ignav")?.origin ?? "none"}
        hasStored={entryOf("ignav")?.hasStored ?? false}
        canTestConnection
        testNote="Comprobar hace una petición real a Ignav: es la única forma de saber si la clave funciona (el endpoint gratuito de estado no valida la clave)."
      />
    </div>
  );
}
