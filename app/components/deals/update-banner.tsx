interface UpdateBannerProps {
  checkedAt: string | null;
  isStale: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  refreshLabel?: string;
  refreshSub?: string;
  staleText?: string;
}

function fmtChecked(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UpdateBanner({
  checkedAt,
  isStale,
  isRefreshing,
  onRefresh,
  refreshLabel = "Actualizar búsqueda",
  refreshSub = "Buscar precios actuales",
  staleText = "el precio puede haber cambiado",
}: UpdateBannerProps) {
  if (!isStale) return null;

  const checked = fmtChecked(checkedAt);

  return (
    <div className="mt-3.5 flex flex-col items-stretch justify-between gap-3.5 rounded-xl border border-opportunity/30 bg-opportunity/10 p-3 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2 text-xs leading-snug text-opportunity">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="size-4 shrink-0"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <span>
          {checked
            ? `Última comprobación: ${checked} · ${staleText}`
            : staleText}
        </span>
      </div>
      <button
        type="button"
        className="flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-brand/40 bg-sky px-3 py-2.5 font-bold text-brand transition-colors hover:bg-sky-2 disabled:cursor-wait disabled:opacity-65"
        onClick={onRefresh}
        disabled={isRefreshing}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="size-4"
          aria-hidden
        >
          <path d="M20 7v5h-5" />
          <path d="M4 17v-5h5" />
          <path d="M5.5 9a7 7 0 0 1 11.7-2L20 12M4 12l2.8 5a7 7 0 0 0 11.7-2" />
        </svg>
        <span className="text-left">
          <span className="block text-sm">
            {isRefreshing ? "Actualizando…" : refreshLabel}
          </span>
          <small className="mt-0.5 block text-[10px] font-medium">
            {refreshSub}
          </small>
        </span>
      </button>
    </div>
  );
}
