import type { FlightLeg } from "./types";

// Stable dedupe key derived from itinerary content, never from result position,
// so one flight keeps a single flight_options row (and one price history) across
// daily runs even when a provider reorders results or returns a different count.
const legPart = (leg: FlightLeg) =>
  `${leg.airline}${leg.flightNumber}${leg.departAt}${leg.arriveAt}` +
  `${leg.departAirport}${leg.arriveAirport}`;

export function optionKey(
  sourceId: string,
  outboundLegs: FlightLeg[],
  inboundLegs: FlightLeg[],
): string {
  return [sourceId, ...outboundLegs.map(legPart), ...inboundLegs.map(legPart)].join(
    "_",
  );
}

// Itinerary-only dedupe key (no sourceId). Used exclusively for cross-source
// aggregation/deduplication, so the identity of the physical itinerary remains
// stable regardless of which source returned it (Opción B).
export function itineraryDedupeKey(
  outboundLegs: FlightLeg[],
  inboundLegs: FlightLeg[],
): string {
  return [...outboundLegs.map(legPart), ...inboundLegs.map(legPart)].join("_");
}
