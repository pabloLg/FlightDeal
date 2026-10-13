import { SEARCH_BUDGET_MS } from "./flight-source";
import type { FlightOption, FlightSearchParams } from "./types";

// Half of the window is capped at the DB's own limit (0..21) so a hand-crafted
// params cannot spin the loop; the wall-clock budget is what actually bounds
// the calls.
const MAX_FLEX_DAYS = 21;

// Wall clock one source may spend enumerating the window. Two flexible HTTP
// sources plus a cold Google load have to stay under the 60 s invocation cap,
// so each gets a third of the chain budget (see AGENTS.md).
export const FLEX_BUDGET_MS = Math.floor(SEARCH_BUDGET_MS / 3);

// 0, +1, -1, +2, -2 …: the base date is asked first so a run that hits the
// budget still covers the date the user actually picked.
export function flexOffsets(flexDays: number): number[] {
  const half = Math.min(Math.max(Math.trunc(flexDays), 0), MAX_FLEX_DAYS);
  const offsets = [0];
  for (let i = 1; i <= half; i++) {
    offsets.push(i, -i);
  }
  return offsets;
}

export function shiftDate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type WindowDay =
  | { ok: true; options: FlightOption[]; currency: string }
  | { ok: false; message: string };

// One source exploring ±flex days: one request per date, the per-day lists
// concatenated. Each option keeps its own dates through its legs, so the UI
// still knows which day is cheap. Nothing is enriched per day: return legs and
// booking links are single-pick extras and N days would multiply them.
//
// Fail-closed like a single-date search: a day that cannot be read is not a day
// with no flights. Only a window where every answered day was empty is a
// verified "no_flights".
export async function fetchFlexWindow(
  params: FlightSearchParams,
  fetchDay: (dayParams: FlightSearchParams) => Promise<WindowDay>,
  budgetMs: number = FLEX_BUDGET_MS,
): Promise<{
  options: FlightOption[];
  currency: string;
  degraded: boolean;
  message?: string;
}> {
  const deadline = Date.now() + budgetMs;
  const options: FlightOption[] = [];
  let currency = params.currency;
  let firstDegraded: string | null = null;
  let degradedDays = 0;
  let truncated = false;

  for (const offset of flexOffsets(params.flexDays ?? 0)) {
    if (Date.now() >= deadline) {
      truncated = true;
      break;
    }
    const day: FlightSearchParams = { ...params, flexDays: undefined };
    if (offset !== 0) {
      day.departDate = shiftDate(params.departDate, offset);
      if (params.returnDate) {
        day.returnDate = shiftDate(params.returnDate, offset);
      }
    }
    const result = await fetchDay(day);
    if (!result.ok) {
      degradedDays++;
      if (firstDegraded === null) firstDegraded = result.message;
      continue;
    }
    if (result.options.length > 0) {
      options.push(...result.options);
      currency = result.currency;
    }
  }

  if (options.length > 0) {
    return { options, currency, degraded: false };
  }
  // Nothing usable and the window was not fully covered: not "no flights", just
  // a degraded run the chain can hand to the next source.
  if (degradedDays > 0 || truncated) {
    return {
      options: [],
      currency,
      degraded: true,
      message: firstDegraded
        ? `flex_partial:${firstDegraded}`
        : "flex_partial:budget_exhausted",
    };
  }
  return { options: [], currency, degraded: false, message: "no_flights" };
}
