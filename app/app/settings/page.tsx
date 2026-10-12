import { redirect } from "next/navigation";

import { SourceCredentials, UserCredentials } from "@/components/settings/source-credentials";
import { CurrencyForm } from "@/components/profile/currency-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getGlobalCredentialStatuses,
  getUserCredentialStatuses,
} from "@/app/actions/source-credentials";
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

  // Own keys: every signed-in user manages their own. The global section only
  // exists for the declared administrator (null for everyone else).
  const [userCredentials, globalCredentials] = await Promise.all([
    getUserCredentialStatuses(),
    getGlobalCredentialStatuses(),
  ]);

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

      <section className="flex flex-col gap-3.5">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-brand-dark">
            Tus claves de fuentes
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Claves de SerpAPI e Ignav que usan tus búsquedas. Se guardan
            cifradas y nunca se muestran. Si no configuras una fuente, tus
            búsquedas usan solo Google Fligths, que no necesita clave.
          </p>
        </div>
        <UserCredentials statuses={userCredentials} />
      </section>

      {globalCredentials ? (
        <section className="flex flex-col gap-3.5">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-brand-dark">
              Claves globales (administrador)
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Solo las usa tu cuenta, y solo cuando no tienes una clave propia
              para esa fuente.
            </p>
          </div>
          <SourceCredentials statuses={globalCredentials} />
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Sesión iniciada como <span className="font-medium">{user.email}</span>.
      </p>
    </main>
  );
}
