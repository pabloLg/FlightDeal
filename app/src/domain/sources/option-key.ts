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
