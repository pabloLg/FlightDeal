import { outboundDepartDate } from "./date-window";
import type { FlightOptionRow } from "./filters";

export type DatedOption = FlightOptionRow & { execution_id: string };

export type ExecutionRef = { id: string };

// Departure days that have at least one stored option, sorted ascending. The
// dedupe key folds the departure date in, so options of different days are
// distinct rows that coexist in flight_options.
export function availableDatesOf(options: FlightOptionRow[]): string[] {
  const dates = new Set<string>();
  for (const opt of options) {
    const date = outboundDepartDate(opt.outbound_legs);
    if (date) dates.add(date);
  }
  return [...dates].sort();
}

// Options for one departure date, from the most recent execution that returned
// that date. Ranked by the caller's execution order (newest first), so a
// re-search never resurfaces rows the latest run of that day no longer offered.
export function resolveDateView(
  options: DatedOption[],
  executions: { id: string }[],
  date: string,
): { rows: DatedOption[]; executionId: string | null } {
  const onDate = options.filter(
    (o) => outboundDepartDate(o.outbound_legs) === date,
  );
  if (onDate.length === 0) return { rows: [], executionId: null };

  const rank = new Map(executions.map((e, i) => [e.id, i]));
  let executionId = onDate[0].execution_id;
  let best = rank.get(executionId) ?? Number.POSITIVE_INFINITY;
  for (const option of onDate) {
    const r = rank.get(option.execution_id) ?? Number.POSITIVE_INFINITY;
    if (r < best) {
      best = r;
      executionId = option.execution_id;
    }
  }
  return {
    rows: onDate.filter((o) => o.execution_id === executionId),
    executionId,
  };
}
