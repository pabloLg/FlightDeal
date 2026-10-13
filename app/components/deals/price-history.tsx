import { PriceArea } from "@/components/charts/price-area";
import { Badge } from "@/components/ui/badge";

import type { RouteHistoryDay } from "@/src/domain/deals/route-history";

// Date-only strings are pinned to UTC so the label never slips a day.
const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });

const minOf = (days: RouteHistoryDay[]) => Math.min(...days.map((d) => d.min));
const maxOf = (days: RouteHistoryDay[]) => Math.max(...days.map((d) => d.max));

// Route history: the observed daily minimum across every search on this route
// (not only the current one), drawn as an area chart with labelled axes and one
// marker per observed day. The statistics are stored in EUR, so they are
// labelled as such and a notice appears when the profile uses another currency
// instead of quietly relabelling someone else's numbers.
function PriceHistory({
  days,
  currency,
  currentPrice,
  habitual,
  searchCount,
}: {
  days: RouteHistoryDay[];
  /** Profile currency, used only to decide whether the EUR notice is needed. */
  currency: string;
  currentPrice: number | null;
  /** Mean of the route's observed daily minimums; baseline for the badge. */
  habitual: number | null;
  /** How many searches of the route are combined in this history. */
  searchCount: number;
}) {
  const diff =
    currentPrice != null && habitual != null && habitual > 0
      ? Math.round((1 - currentPrice / habitual) * 100)
      : null;
  const bestDay =
    days.length > 0 ? days.reduce((a, b) => (b.min < a.min ? b : a)) : null;

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

      {days.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Sin observaciones todavía: el mínimo diario aparece tras las próximas
          ejecuciones de esta ruta.
        </p>
      ) : (
        <>
          <PriceArea
            days={days}
            habitual={habitual}
            ariaLabel={`Evolución del mínimo diario observado (EUR): ${minOf(
              days,
            ).toFixed(2)} a ${maxOf(days).toFixed(2)} EUR, del ${fmtDay(
              days[0].date,
            )} al ${fmtDay(days[days.length - 1].date)}.`}
          />
          <p className="text-xs text-muted-foreground">
            {searchCount > 1
              ? `${searchCount} búsquedas de esta ruta combinadas · `
              : ""}
            mínimo del período {minOf(days).toFixed(2)} EUR · rango{" "}
            {minOf(days).toFixed(2)}–{maxOf(days).toFixed(2)} EUR
          </p>
          {bestDay && (
            <p className="text-xs text-muted-foreground">
              Mejor día: {fmtDay(bestDay.date)} · {bestDay.min.toFixed(2)} EUR
            </p>
          )}
        </>
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
