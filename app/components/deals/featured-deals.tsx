import { Flame, Plane } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

import { DealCard, type Deal } from "./deal-card";

export function FeaturedDeals({
  deals,
  searchCount,
}: {
  deals: Deal[];
  searchCount: number;
}) {
  const singleSearch = searchCount === 1;

  return (
    <section>
      <div className="mb-3.5 flex items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-brand-dark">
            <Flame className="size-5 text-opportunity" />
            {singleSearch ? "Tu mejor oportunidad" : "Oportunidades detectadas"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Los mejores precios encontrados en tus búsquedas.
          </p>
        </div>
      </div>

      {searchCount === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Plane className="size-8 text-brand/60" aria-hidden />
            <p className="font-semibold text-brand-dark">
              ☁️ Estamos esperando tus primeros resultados
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              Crea tu primera búsqueda arriba y aquí aparecerán las
              oportunidades que encontremos.
            </p>
          </CardContent>
        </Card>
      ) : deals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="font-semibold text-brand-dark">
              Todavía no hay precios
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              Tus rutas están monitorizadas. En cuanto se ejecute una búsqueda
              verás aquí los precios encontrados.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {deals.map((deal, i) => (
            <DealCard key={deal.optionId} deal={deal} featured={i === 0} />
          ))}
        </div>
      )}
    </section>
  );
}