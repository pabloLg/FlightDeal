import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Dashboard | Flight Deal Tracker",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Hola, {user.email}</p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="outline">
            Cerrar sesión
          </Button>
        </form>
      </div>
      <p className="text-muted-foreground">
        Tus búsquedas de vuelos aparecerán aquí en la fase F2.
      </p>
    </main>
  );
}