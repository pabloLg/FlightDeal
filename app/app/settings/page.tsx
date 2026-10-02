import { redirect } from "next/navigation";

import { CurrencyForm } from "@/components/profile/currency-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
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

      <p className="text-xs text-muted-foreground">
        Sesión iniciada como <span className="font-medium">{user.email}</span>.
      </p>
    </main>
  );
}