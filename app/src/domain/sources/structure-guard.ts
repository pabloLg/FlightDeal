import { extractDs1Json } from "./parse-page";

// Structure guard for the Google Flights results page: fail-closed validation
// that a captured HTML still matches the shape the parser expects. On any
// mismatch the caller must NOT persist results (source_structure_version grows
// and the execution is marked failed/degraded).
//
// A page with the expected markers and a parseable ds:1 payload is a valid
// results page even when it lists 0 options (no flights found) — that is a
// legitimate empty result, not a structure break.

export interface StructureCheck {
  ok: boolean;
  version: number;
  reason?: string;
}

export const STRUCTURE_VERSION = 1;

// Markers that must be present on a valid results page. Title proves we got
// the Google Flights shell (not a consent wall / error page); the ds:1
// callback proves flight data was materialized.
const PAGE_MARKERS = [
  "Google Vuelos",
  "AF_initDataCallback({key: 'ds:1'",
  "AF_initDataCallback({key: 'ds:0'",
];

export function structureGuard(html: string): StructureCheck {
  for (const marker of PAGE_MARKERS) {
    if (!html.includes(marker)) {
      return {
        ok: false,
        version: STRUCTURE_VERSION,
        reason: `missing_marker:${marker}`,
      };
    }
  }

  // Parser-level check: the ds:1 payload must be present and parse as an
  // array. A truncated or re-escaped capture that no longer yields JSON is
  // corrupt data → fail-closed (never persist it).
  const data = extractDs1Json(html);
  if (data === null) {
    return {
      ok: false,
      version: STRUCTURE_VERSION,
      reason: "parse_failed:ds1_missing_or_corrupt",
    };
  }

  return { ok: true, version: STRUCTURE_VERSION };
}