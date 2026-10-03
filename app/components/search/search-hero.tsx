import { SearchForm } from "./search-form";

export function SearchHero() {
  return (
    <section className="relative overflow-hidden pb-2 pt-10">
      <div className="relative mb-6 max-w-2xl">
        <div aria-hidden className="pointer-events-none">
          <div className="plane">✈</div>
          <div className="cloud one" />
          <div className="cloud two" />
        </div>

        <div className="relative z-2">
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
      </div>

      <SearchForm />
    </section>
  );
}
