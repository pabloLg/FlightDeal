import { Bell } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";

export type RecentAlert = {
  id: string;
  /** "MAD → BCN", built from the search this alert belongs to. */
  route: string;
  /** Threshold in EUR as configured on the search, or null when unset. */
  thresholdEur: number | null;
  /** Price the alert fired on. Dispatches store it in EUR. */
  price: number;
  /** Storage status: dispatched (recorded), delivered, or failed. */
  status: "dispatched" | "delivered" | "failed";
  dispatchedAt: string;
};

// Deliberately "Detectada" and not "Enviada": nothing is actually delivered
// until a notification channel exists (F6), so claiming a send would be a lie.
const STATUS: Record<
  RecentAlert["status"],
  { label: string; variant: "ok" | "warn" | "danger" | "info" | "neutral" }
> = {
  dispatched: { label: "Detectada", variant: "info" },
  delivered: { label: "Entregada", variant: "ok" },
  failed: { label: "Fallida", variant: "danger" },
};

const dateFormat = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

// Recent price alerts across the profile, read from the same dispatches the
// per-search page shows, so there is no second source of truth.
export function RecentAlertsCard({ alerts }: { alerts: RecentAlert[] }) {
  return (
    <SectionCard
      id="alerts"
      icon={<Bell className="size-5 text-brand" aria-hidden />}
      title="Alertas recientes"
      description="Avisos disparados por tus umbrales."
    >
      {alerts.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-8" aria-hidden />}
          title="Sin avisos todavía"
          body="Cuando el mejor precio de una ruta baje de su umbral, lo verás aquí."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {alerts.map((alert) => {
            const status = STATUS[alert.status] ?? STATUS.dispatched;
            return (
              <li
                key={alert.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-border bg-card px-3.5 py-3 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-brand-dark">
                    {alert.route}
                  </span>
                  <span className="ml-2 text-muted-foreground tabular-nums">
                    {alert.price.toFixed(2)} EUR
                    {alert.thresholdEur != null
                      ? ` · umbral ${alert.thresholdEur.toFixed(0)} EUR`
                      : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {dateFormat.format(new Date(alert.dispatchedAt))}
                  </span>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
