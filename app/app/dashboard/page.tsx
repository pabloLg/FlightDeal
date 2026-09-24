import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { signOut } from "@/app/actions/auth";
import { SearchesView } from "@/components/search/searches-view";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

  const { data: searches } = await supabase
    .from("searches")
    .select("*")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: true });

  const searchIds = (searches ?? []).map((s) => s.id);

  type ExecutionRow = {
    search_id: string;
    id: string;
    status: string;
    finished_at: string | null;
    created_at: string;
  };

  const lastExecution = new Map<string, ExecutionRow>();
  if (searchIds.length > 0) {
    const { data: executions } = await supabase
      .from("search_executions")
      .select("search_id, id, status, finished_at, created_at")
      .in("search_id", searchIds)
      .order("created_at", { ascending: false });
    for (const exec of (executions ?? []) as ExecutionRow[]) {
      if (!lastExecution.has(exec.search_id))
        lastExecution.set(exec.search_id, exec);
    }
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

      <SearchesView
        searches={(searches ?? []).map((s) => ({
          ...s,
          lastExecution: lastExecution.get(s.id) ?? null,
        }))}
      />
    </main>
  );
}