"use client";

import { cn } from "cn";

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function toDateOnly(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Parse YYYY-MM-DD as UTC so a date never shifts across the local timezone.
function fromDateOnly(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function WeeklyCalendar({
  selectedDate,
  onSelect,
  weekOffset = 0,
  onWeekChange,
  availableDates,
}: {
  selectedDate: string | null;
  onSelect: (date: string) => void;
  weekOffset?: number;
  onWeekChange?: (offset: number) => void;
  availableDates?: string[];
}) {
  const today = new Date();
  const base =
    fromDateOnly(selectedDate) ??
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), new Date().getUTCDate()));
  const weekStart = startOfWeek(base);
  weekStart.setUTCDate(weekStart.getUTCDate() + weekOffset * 7);

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setUTCDate(weekStart.getUTCDate() + i);
    days.push(d);
  }

  const withOffer = new Set(availableDates ?? []);

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border bg-white p-2.5">
      <button
        type="button"
        aria-label="Semana anterior"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-sky text-xl leading-none text-brand-dark transition-colors hover:bg-sky-2"
        onClick={() => onWeekChange?.(weekOffset - 1)}
      >
        ‹
      </button>
      <div className="grid flex-1 grid-cols-7 gap-1.5">
        {days.map((d) => {
          const iso = toDateOnly(d);
          const isSelected = iso === selectedDate;
          const hasOffer = withOffer.has(iso);
          return (
            <button
              key={iso}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${hasOffer ? ", con oferta guardada" : ""}`}
              className={cn(
                "flex min-h-20 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border bg-white py-2 text-muted-foreground transition-colors hover:border-brand/40 hover:bg-sky",
                isSelected
                  ? "border-2 border-brand bg-sky font-bold text-brand-dark"
                  : "border-border",
              )}
              onClick={() => onSelect(iso)}
            >
              <span className="text-xs">{DAY_NAMES[d.getUTCDay()]}</span>
              <span className="text-sm font-semibold">
                {d.getUTCDate()} {MONTHS[d.getUTCMonth()]}
              </span>
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  isSelected
                    ? "bg-brand"
                    : hasOffer
                      ? "bg-brand/60"
                      : "bg-border",
                )}
              />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="Semana siguiente"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-sky text-xl leading-none text-brand-dark transition-colors hover:bg-sky-2"
        onClick={() => onWeekChange?.(weekOffset + 1)}
      >
        ›
      </button>
    </div>
  );
}
