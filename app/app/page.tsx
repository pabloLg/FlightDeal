import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[1420px] px-6">
      <section className="hero">
        <div aria-hidden className="pointer-events-none">
          <div className="plane">✈</div>
          <div className="cloud one" />
          <div className="cloud two" />
        </div>

        <div className="hero-copy">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-brand">
            Tu radar de viajes
          </span>
          <h1 className="mt-3 text-4xl font-extrabold leading-[1.02] tracking-tight text-brand-dark sm:text-6xl">
            Encuentra tu próxima escapada.
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Busca vuelos, descubre precios especiales y recibe una alerta cuando
            aparezca una oportunidad que merezca la pena.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              className="h-11 px-6 text-base"
              render={<Link href="/signup" />}
            >
              Empezar gratis
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 px-6 text-base"
              render={<Link href="/login" />}
            >
              Iniciar sesión
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}