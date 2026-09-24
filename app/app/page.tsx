import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">
        Flight Deal Tracker
      </h1>
      <p className="max-w-md text-muted-foreground">
        Monitoriza precios de vuelos, guarda el histórico y recibe alertas cuando
        aparezcan buenos precios.
      </p>
      <div className="flex gap-3">
        <Button render={<Link href="/login" />}>Iniciar sesión</Button>
        <Button render={<Link href="/signup" />} variant="outline">
          Crear cuenta
        </Button>
      </div>
    </main>
  );
}