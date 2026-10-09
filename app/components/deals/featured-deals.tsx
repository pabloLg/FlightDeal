import { Flame, Plane } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { DealCard, type Deal } from "./deal-card";

// The dashboard's most valuable module: the cheapest observed option of each
// search, cheapest-first inside the profile currency group. The caller hands
// over already-ranked deals and whether the top one is comparable.
export function FeaturedDeals({
  deals,
  searchCount,
  featuredIsHonest,
}: {
  deals: Deal[];
  searchCount: number;
  featuredIsHonest: boolean;
}) {
  const singleSearch = searchCount === 1;

  return (
    <SectionCard
      id="opportunities"
      icon={<Flame className="size-5 text-opportunity" aria-hidden />}
      title={singleSearch ? "Tu mejor oportunidad" : "Oportunidades detectadas"}
      description={
        singleSearch
          ? "El mejor precio observado en tu ruta vigilada."
          : "El mejor precio observado en cada una de tus rutas."
      }
    >
      {searchCount === 0 ? (
        <EmptyState
          icon={<Plane className="size-8" aria-hidden />}
          title="☁️ Estamos esperando tus primeros resultados"
          body="Crea tu primera búsqueda arriba y aquí aparecerán las oportunidades que encontremos."
        />
      ) : deals.length === 0 ? (
        <EmptyState
          title="Todavía no hay precios"
          body="Tus rutas están monitorizadas. En cuanto se ejecute una búsqueda verás aquí los precios encontrados."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {deals.map((deal, i) => (
            <DealCard
              key={deal.optionId}
              deal={deal}
              featured={i === 0 && featuredIsHonest}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
