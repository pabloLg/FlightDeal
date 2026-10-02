import Link from "next/link";
import { Flame } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

import { DealCard, type Deal } from "./deal-card";

export function FeaturedDeals({ deals }: { deals: Deal[] }) {
  return (
    <section>
      <div className="mb-3.5 flex items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-brand-dark">
            <Flame className="size-5 text-opportunity" />
            Oportunidades detectadas
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Los mejores precios encontrados en tus búsquedas.
          </p>
        </div>
      </div>

      {deals.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Todavía no hay oportunidades. Crea una búsqueda y ejecútala para ver
            aquí el mejor precio de cada ruta.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {deals.map((deal, i) => (
            <DealCard
              key={deal.searchId}
              deal={deal}
              featured={i === 0}
            />
          ))}
          {deals.length > 3 && (
            <Link
              href="#searches"
              className="shrink-0 text-sm font-semibold text-brand hover:underline mt-4 block"
            >
              Ver todas las ofertas →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
