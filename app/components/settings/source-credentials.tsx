"use client";

import { useActionState } from "react";
import { AlertCircle, Check, KeyRound, Trash2 } from "lucide-react";

import {
  clearSourceCredential,
  clearUserCredential,
  saveSourceCredential,
  saveUserCredential,
  testSourceConnection,
  testUserCredential,
  type CredentialState,
} from "@/app/actions/source-credentials";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

const empty: CredentialState = {};

type Action = (
  prev: CredentialState,
  formData: FormData,
) => Promise<CredentialState>;

const NO_TEST_NOTE_SERPAPI =
  "Verificar consume cuota: cualquier llamada gasta una búsqueda. Si guardas la clave y una ejecución devuelve resultados, está correcta.";

const TEST_NOTE_IGNAV =
  "Comprobar hace una petición real a Ignav: es la única forma de saber si la clave funciona (el endpoint gratuito de estado no valida la clave).";

function FieldNotes({
  message,
  saved,
  testOk,
}: {
  message?: string;
  saved?: boolean;
  testOk?: boolean;
}) {
  return (
    <>
      {saved ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-savings">
          <Check className="size-3.5" aria-hidden />
          Guardada.
        </p>
      ) : null}
      {testOk ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-savings">
          <Check className="size-3.5" aria-hidden />
          Conexión correcta.
        </p>
      ) : null}
      {message ? (
        <p
          className="flex items-start gap-1.5 text-xs text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {message}
        </p>
      ) : null}
    </>
  );
}

/**
 * One source card: save, test and remove. Trouser-legs identical for the
 * caller's own key and for the admin's global one; only the actions and the
 * wording change.
 */
function CredentialCard({
  idPrefix,
  provider,
  label,
  description,
  docsUrl,
  status,
  statusVariant,
  onSave,
  onTest,
  onClear,
  clearLabel,
  clearNote,
  notConfiguredNote,
  extraNote,
  testNoteOverride,
}: {
  idPrefix: string;
  provider: string;
  label: string;
  description: string;
  docsUrl: string;
  status: string;
  statusVariant: "ok" | "warn" | "info";
  onSave: Action;
  onTest: Action;
  onClear: Action;
  clearLabel: string;
  clearNote: string;
  notConfiguredNote?: string;
  extraNote?: string;
  testNoteOverride?: string;
}) {
  const [saveState, saveDispatch] = useActionState(onSave, empty);
  const [clearState, clearDispatch] = useActionState(onClear, empty);
  const [testState, testDispatch] = useActionState(onTest, empty);
  const isTestable = Boolean(testNoteOverride);
  const message = saveState?.error ?? clearState?.error ?? testState?.error;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-brand" aria-hidden />
            {label}
          </CardTitle>
          <Badge variant={statusVariant} dot>
            {status}
          </Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form action={saveDispatch} className="flex flex-col gap-3">
          <input type="hidden" name="provider" value={provider} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-${provider}`}>
              {statusVariant === "ok" ? `Sustituir clave (${label})` : `Clave (${label})`}
            </Label>
            <input
              className="field-control h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              id={`${idPrefix}-${provider}`}
              name="secret"
              type="password"
              autoComplete="off"
              placeholder="Pega la clave aquí"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm">
              Guardar
            </Button>
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          {isTestable ? (
            <form action={testDispatch}>
              <input type="hidden" name="provider" value={provider} />
              <Button type="submit" size="sm" variant="outline">
                Probar conexión
              </Button>
            </form>
          ) : null}
          {statusVariant === "ok" ? (
            <form action={clearDispatch}>
              <input type="hidden" name="provider" value={provider} />
              <Button type="submit" size="sm" variant="destructive">
                <Trash2 className="size-3.5" aria-hidden />
                {clearLabel}
              </Button>
            </form>
          ) : null}
        </div>

        <FieldNotes
          message={message}
          saved={saveState?.ok === true}
          testOk={testState?.ok === true && !testState?.error}
        />

        {statusVariant === "ok" ? (
          <p className="text-xs text-muted-foreground">{clearNote}</p>
        ) : notConfiguredNote ? (
          <p className="text-xs text-muted-foreground">{notConfiguredNote}</p>
        ) : null}
        {extraNote ? (
          <p className="text-xs text-muted-foreground">{extraNote}</p>
        ) : null}
        {testNoteOverride ? null : (
          <p className="text-xs text-muted-foreground">{NO_TEST_NOTE_SERPAPI}</p>
        )}

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

/** The caller's own keys. Every signed-in user gets this section. */
export function UserCredentials({
  statuses,
}: {
  statuses: {
    provider: string;
    hasOwn: boolean;
    effective: "user" | "global" | "none";
  }[];
}) {
  if (statuses.length === 0) return null;
  const entryOf = (provider: string) => statuses.find((s) => s.provider === provider);

  const card = (
    provider: string,
    label: string,
    description: string,
    docsUrl: string,
    testNoteOverride?: string,
  ) => {
    const hasOwn = entryOf(provider)?.hasOwn ?? false;
    const effective = entryOf(provider)?.effective ?? "none";
    return (
      <CredentialCard
        key={provider}
        idPrefix="own"
        provider={provider}
        label={label}
        description={description}
        docsUrl={docsUrl}
        status={hasOwn ? "Tu clave" : "Sin configurar"}
        statusVariant={hasOwn ? "ok" : "warn"}
        onSave={saveUserCredential}
        onTest={testUserCredential}
        onClear={clearUserCredential}
        clearLabel="Quitar la mía"
        clearNote="Esta fuente dejará de usarse en tus búsquedas."
        notConfiguredNote="Sin configurar: tus búsquedas usarán solo Google Flights, que no necesita clave."
        extraNote={
          !hasOwn && effective === "global"
            ? "Eres administrador y no tienes clave propia: se está usando tu clave global para esta fuente."
            : undefined
        }
        testNoteOverride={testNoteOverride}
      />
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {card(
        "serpapi",
        "SerpAPI",
        "Motor google_flights de SerpAPI. Cada búsqueda consume cuota (250/mes en el plan gratuito).",
        "https://serpapi.com/dashboard",
      )}
      {card(
        "ignav",
        "Ignav",
        "API de tarifas de Ignav. Devuelve ida y vuelta en la misma respuesta y tiene enlaces de reserva.",
        "https://ignav.com/dashboard",
        TEST_NOTE_IGNAV,
      )}
    </div>
  );
}

/** The administrator's global keys. Only the admin ever sees this section. */
export function SourceCredentials({
  statuses,
}: {
  statuses: {
    provider: string;
    origin: "global" | "none";
    hasStored: boolean;
  }[];
}) {
  if (statuses.length === 0) return null;
  const entryOf = (provider: string) => statuses.find((s) => s.provider === provider);

  const card = (
    provider: string,
    label: string,
    description: string,
    docsUrl: string,
    testNoteOverride?: string,
  ) => {
    const hasStored = entryOf(provider)?.hasStored ?? false;
    return (
      <CredentialCard
        key={provider}
        idPrefix="global"
        provider={provider}
        label={label}
        description={description}
        docsUrl={docsUrl}
        status={hasStored ? "Configurada" : "Sin configurar"}
        statusVariant={hasStored ? "ok" : "warn"}
        onSave={saveSourceCredential}
        onTest={testSourceConnection}
        onClear={clearSourceCredential}
        clearLabel="Quitar la global"
        clearNote="Dejará de aplicarse a tus búsquedas."
        testNoteOverride={testNoteOverride}
      />
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {card(
        "serpapi",
        "SerpAPI",
        "Clave global de SerpAPI. Solo la usa tu cuenta, y solo si no tienes clave propia para esta fuente.",
        "https://serpapi.com/dashboard",
      )}
      {card(
        "ignav",
        "Ignav",
        "Clave global de Ignav. Solo la usa tu cuenta, y solo si no tienes clave propia para esta fuente.",
        "https://ignav.com/dashboard",
        TEST_NOTE_IGNAV,
      )}
    </div>
  );
}
