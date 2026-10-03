import type { FlightLeg } from "./types";
import { itineraryDedupeKey } from "./option-key";

export { itineraryDedupeKey };
export const itineraryKey = itineraryDedupeKey;
