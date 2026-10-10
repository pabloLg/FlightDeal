import { redirect } from "next/navigation";

import { SourceCredentials } from "@/components/settings/source-credentials";
import { CurrencyForm } from "@/components/profile/currency-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCredentialStatuses } from "@/app/actions/source-credentials";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Configuración | FlightDeal" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("currency")
    .eq("id", user.id)
    .single();

  // Null when the signed-in user is not the admin: the section simply does not
  // exist for them instead of showing buttons they cannot use.
  const credentialStatuses = (await getCredentialStatuses()) ?? [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 pb-16">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-brand-dark">
          Configuración
        </h1>
        <p className="text-sm text-muted-foreground">
          Preferencias de tu cuenta.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Moneda</CardTitle>
          <CardDescription>
            Se aplica a los precios y a los umbrales de tus alertas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CurrencyForm current={profile?.currency ?? "EUR"} />
        </CardContent>
      </Card>

      {credentialStatuses.length > 0 ? (
        <section className="flex flex-col gap-3.5">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-brand-dark">
              Fuentes de vuelos
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Credenciales de las integraciones. Se guardan cifradas y nunca se
              muestran; la variable de entorno del servidor tiene prioridad
              sobre la guardada aquí.
            </p>
          </div>
          <SourceCredentials statuses={credentialStatuses} />
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Sesión iniciada como <span className="font-medium">{user.email}</span>.
      </p>
    </main>
  );
}