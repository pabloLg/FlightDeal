import { Badge } from "@/components/ui/badge";

export type PriceStatRow = {
  stats_date: string;
  min_price_eur: number;
  max_price_eur: number;
  avg_price_eur: number;
  observations: number;
};

// Historical daily range (min-max) with the average marked, drawn in CSS
// from data the app already stores. No chart library, no invented points.
// The statistics are stored in EUR, so they are labelled as such and a
// notice appears when the profile uses another currency instead of quietly
// relabelling someone else's numbers.
function PriceHistory({
  stats,
  currency,
  currentPrice,
}: {
  stats: PriceStatRow[];
  /** Profile currency, used only to decide whether the EUR notice is needed. */
  currency: string;
  currentPrice: number | null;
}) {
  const max = Math.max(...stats.map((s) => s.max_price_eur), 0);
  const hasHistory = stats.some((s) => s.observations > 0);
  const habitual =
    stats.reduce((acc, s) => acc + s.avg_price_eur, 0) / (stats.length || 1);
  const diff =
    currentPrice != null && habitual > 0
      ? Math.round((1 - currentPrice / habitual) * 100)
      : null;
  const scale = (value: number) => (max > 0 ? Math.max(4, (value / max) * 100) : 4);

  return (
    <div className="flex flex-col gap-3">
      {currentPrice != null && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-brand-dark">Precio actual</span>
          <span className="font-extrabold text-ink tabular-nums">
            {currentPrice.toFixed(2)} EUR
          </span>
          {diff != null &&
            (diff >= 0 ? (
              <Badge variant="ok">−{diff}% frente al habitual</Badge>
            ) : (
              <Badge variant="warn">+{Math.abs(diff)}% frente al habitual</Badge>
            ))}
        </div>
      )}

      {currency !== "EUR" && (
        <p className="text-xs text-muted-foreground">
          Histórico disponible en EUR.
        </p>
      )}

      {stats.map((s) => {
        const min = scale(s.min_price_eur);
        const maxH = Math.max(min + 1, scale(s.max_price_eur));
        return (
          <div
            key={s.stats_date}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
          >
            <span className="w-24 shrink-0 text-muted-foreground">
              {new Date(s.stats_date).toLocaleDateString("es-ES")}
            </span>
            <div className="relative h-16 flex-1">
              {/* Observed range for the day. */}
              <div
                className="absolute bottom-0 w-full rounded-t bg-brand/25"
                style={{ height: `${maxH}%` }}
              />
              {/* Cheapest observed price that day. */}
              <div
                className="absolute bottom-0 w-full rounded-t bg-brand"
                style={{ height: `${min}%` }}
                title={`mínimo ${s.min_price_eur.toFixed(2)} EUR`}
              />
              {/* Average, as a reference mark rather than a bar. */}
              <div
                aria-hidden
                className="absolute inset-x-0 border-t border-dashed border-savings"
                style={{ bottom: `${scale(s.avg_price_eur)}%` }}
                title={`media ${s.avg_price_eur.toFixed(2)} EUR`}
              />
            </div>
            <span className="w-32 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {s.min_price_eur.toFixed(2)} – {s.max_price_eur.toFixed(2)} EUR
            </span>
            <span className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              media {s.avg_price_eur.toFixed(2)}
            </span>
          </div>
        );
      })}

      {!hasHistory && (
        <p className="text-xs text-muted-foreground">
          Sin observaciones todavía: el agregado diario (mínimo, máximo y media)
          aparece tras las próximas ejecuciones de esta búsqueda.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Histórico observado: no es una predicción de precios futuros.
      </p>
    </div>
  );
}

export type DispatchRow = {
  id: string;
  price_eur: number;
  status: "dispatched" | "delivered" | "failed";
  dispatched_at: string;
  alerts_edge:
    | { threshold_eur: number; provider: string }
    | { threshold_eur: number; provider: string }[]
    | null;
};

// "Detectada" rather than "Enviada": nothing is actually delivered until a
// notification channel exists (F6), so claiming a send would be a lie.
const STATUS_LABEL: Record<
  DispatchRow["status"],
  { label: string; variant: "ok" | "warn" | "danger" | "info" }
> = {
  dispatched: { label: "Detectada", variant: "info" },
  delivered: { label: "Entregada", variant: "ok" },
  failed: { label: "Fallida", variant: "danger" },
};

function AlertHistory({
  dispatches,
  thresholdEur,
}: {
  dispatches: DispatchRow[];
  /** Threshold configured on the search, to explain the condition. */
  thresholdEur: number | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {thresholdEur != null
          ? `Avisamos cada vez que el mejor precio baja de ${thresholdEur.toFixed(0)} EUR.`
          : "Configura un umbral en Mis búsquedas para recibir avisos."}
      </p>
      {dispatches.map((d) => {
        const edge = Array.isArray(d.alerts_edge) ? d.alerts_edge[0] : d.alerts_edge;
        const status = STATUS_LABEL[d.status] ?? STATUS_LABEL.dispatched;
        return (
          <div
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
          >
            <span className="text-muted-foreground">
              {new Date(d.dispatched_at).toLocaleString("es-ES")}
            </span>
            <span className="font-medium text-ink tabular-nums">
              {d.price_eur.toFixed(2)} EUR
              {edge ? ` · umbral ${edge.threshold_eur.toFixed(2)} EUR` : ""}
            </span>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
        );
      })}
    </div>
  );
}

export { AlertHistory, PriceHistory };
