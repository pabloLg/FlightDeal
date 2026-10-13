import type { FlightLegLike } from "./filters";

// What the mockup's flight-block needs per direction: the endpoints (first
// departure, last arrival), the gate-to-gate flight time (sum of segment
// durations, so connections don't inflate it with layover) and the stops count.
export type DirectionSummary = {
  departAirport: string;
  arriveAirport: string;
  departAt: string;
  arriveAt: string;
  durationMin: number;
  stops: number;
};

export function directionSummary(
  legs: FlightLegLike[] | null | undefined,
): DirectionSummary | null {
  if (!legs || legs.length === 0) return null;
  const first = legs[0];
  const last = legs[legs.length - 1];
  return {
    departAirport: first.departAirport,
    arriveAirport: last.arriveAirport,
    departAt: first.departAt,
    arriveAt: last.arriveAt,
    durationMin: legs.reduce((sum, l) => sum + (Number(l.durationMin) || 0), 0),
    stops: Math.max(0, legs.length - 1),
  };
}
