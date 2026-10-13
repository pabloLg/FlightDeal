import { Clock } from "lucide-react";

import { fmtFreshness } from "@/lib/flight-display";
import { isStale } from "@/src/domain/deals/date-window";
import { cn } from "cn";

// "Comprobado hace 2 h", with the stale variant the results page spells out
// by hand. Returns nothing when there is no timestamp, so callers can use it
// inline without an empty label showing.
function FreshnessChip({
  checkedAt,
  className,
}: {
  checkedAt: string | null;
  className?: string;
}) {
  const label = fmtFreshness(checkedAt);
  if (!label) return null;

  const stale = isStale(checkedAt);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        stale
          ? "bg-opportunity/10 text-opportunity"
          : "bg-muted text-muted-foreground",
        className,
      )}
      title={
        stale
          ? "Precios de hace más de 24 h: pueden haber cambiado."
          : undefined
      }
    >
      <Clock className="size-3.5" aria-hidden />
      {stale ? `${label} · puede haber cambiado` : `Comprobado ${label}`}
    </span>
  );
}

export { FreshnessChip };
