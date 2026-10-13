interface DateEmptyStateProps {
  title?: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  isLoading?: boolean;
  error?: string | null;
  showAction?: boolean;
}

export function DateEmptyState({
  title = "Sin resultados guardados",
  message,
  actionLabel,
  onAction,
  isLoading = false,
  error = null,
  showAction = true,
}: DateEmptyStateProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
      <div className="font-medium text-brand-dark">{title}</div>
      <div className="mt-1">{message}</div>
      {error && <div className="mt-2 text-destructive">{error}</div>}
      {showAction && (
        <button
          type="button"
          className="mt-3 rounded-lg border border-border px-3 py-2 text-sm font-bold text-brand-dark transition-colors hover:bg-muted"
          onClick={onAction}
          disabled={isLoading}
        >
          {isLoading ? "Buscando..." : actionLabel}
        </button>
      )}
    </div>
  );
}
