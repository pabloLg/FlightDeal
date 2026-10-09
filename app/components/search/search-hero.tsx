import { Bell, Clock, Plane, Radar } from "lucide-react";

import { SearchForm } from "./search-form";

export type VigilanceSummary = {
  /** Searches this profile owns. */
  searches: number;
  /** Searches with at least one observed price. */
  priced: number;
  /** Newest finished execution across the profile, if any. */
  lastCheckedAt: string | null;
};

// Compact hero: the eyebrow, the promise and a short read of what the radar
// is doing, then the create-search form. It used to be a tall empty band
// that pushed the opportunities below the fold.
export function SearchHero({ summary }: { summary?: VigilanceSummary }) {
  const checks =
    summary && summary.searches > 0
      ? [
          { icon: <Radar className="size-3.5" aria-hidden />, text: `${summary.searches} rutas vigiladas` },
          { icon: <Plane className="size-3.5" aria-hidden />, text: `${summary.priced} con precios` },
        ]
      : [];

  return (
    <section className="relative overflow-hidden pb-2 pt-8">
      <div className="relative mb-5 max-w-2xl">
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

          {checks.length > 0 && (
            <ul className="mt-4 flex flex-wrap items-center gap-2">
              {checks.map((chip) => (
                <li
                  key={chip.text}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-brand-dark ring-1 ring-brand/10"
                >
                  {chip.icon}
                  {chip.text}
                </li>
              ))}
              {summary?.lastCheckedAt ? (
                <li className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-brand/10">
                  <Clock className="size-3.5" aria-hidden />
                  Última comprobación{" "}
                  {new Date(summary.lastCheckedAt).toLocaleDateString("es-ES", {
                    day: "numeric",
                    month: "short",
                  })}
                </li>
              ) : (
                <li className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-brand/10">
                  <Bell className="size-3.5" aria-hidden />
                  Sin comprobaciones todavía
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      <SearchForm />
    </section>
  );
}
