import Link from "next/link";

import { Button } from "@/components/ui/button";

export function HeroSection() {
  return (
    <section className="hero">
      <div className="plane">✈</div>
      <div className="cloud one" />
      <div className="cloud two" />
    </section>
  );
}

export default function Home() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 py-20 text-center">
      <HeroSection />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -right-16 top-10 h-16 w-72 rounded-full bg-white/70 shadow-soft" />
        <div className="absolute -right-4 top-28 h-10 w-52 rounded-full bg-white/50" />
        <div className="absolute -left-24 top-44 h-12 w-56 rounded-full bg-white/50" />
      </div>

      <div className="relative z-10 flex max-w-2xl flex-col items-center">
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
    </main>
  );
}
