import { SearchForm } from "./search-form";

export function SearchHero() {
  return (
    <section className="relative overflow-hidden pb-2 pt-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -right-10 top-0 h-16 w-72 rounded-full bg-white/70 shadow-soft" />
        <div className="absolute right-28 top-20 h-10 w-52 rounded-full bg-white/50" />
        <div className="absolute -left-20 top-28 h-12 w-60 rounded-full bg-white/50" />
      </div>

      <div className="mb-6 max-w-2xl">
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-brand">
          Tu radar de viajes
        </span>
        <h1 className="mt-2 text-4xl font-extrabold leading-[1.03] tracking-tight text-brand-dark sm:text-5xl">
          Encuentra tu próxima escapada.
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
          Busca vuelos, descubre precios especiales y recibe una alerta cuando
          aparezca una oportunidad que merezca la pena.
        </p>
      </div>

      <SearchForm />
    </section>
  );
}
