import Link from "next/link";
import { Plane } from "lucide-react";

import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

import { HeaderNav } from "./header-nav";

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="sticky top-0 z-40 border-b border-brand/10 bg-white/70 backdrop-blur-md">
      <div className="mx-auto flex min-h-18 max-w-[1420px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-2 md:py-0">
        <Link
          href={user ? "/dashboard" : "/"}
          className="flex items-center gap-2.5 font-extrabold tracking-tight text-brand-dark"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-white shadow-soft">
            <Plane className="size-5 text-brand" />
          </span>
          FlightDeal
        </Link>

        {user ? <HeaderNav /> : null}

        {user ? (
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user.email}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                Cerrar sesión
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" render={<Link href="/login" />}>
              Entrar
            </Button>
            <Button size="sm" render={<Link href="/signup" />}>
              Crear cuenta
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
