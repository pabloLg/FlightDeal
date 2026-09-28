import {
  parseLeg,
  parseOptionsPayload,
  type RawFlightLeg,
  type RawFlightOption,
} from "./parse-page";

// Return legs of a round trip: after selecting an outbound flight, Google Flights
// renders the return list from the GetShoppingResults RPC, not from the page
// HTML (the page's ds:1 still holds the outbound options). The RPC body is a
// length-prefixed frame stream:
//
//   )]}'\n\n<len>\n[["wrb.fr",null,"<json payload as string>",…]]\n<len>\n[…]
//
// The payload holds the return options at data[3][0] (same shape as ds:1) and
// the selected outbound inside data[1], whose leg list identifies which
// outbound option the return belongs to.

export interface ReturnLegsPayload {
  selectedOutbound: RawFlightLeg[];
  options: RawFlightOption[];
}

function parseFramePayloads(body: string): unknown[] {
  const payloads: unknown[] = [];
  // Frames are one `<len>` line plus one single-line JSON body. A body that
  // breaks that shape yields no payload (fail-closed: no enrichment, no data).
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\d+$/.test(lines[i].trim())) continue;
    try {
      const frame: unknown = JSON.parse(lines[i + 1]);
      if (!Array.isArray(frame)) continue;
      for (const entry of frame) {
        if (Array.isArray(entry) && entry[0] === "wrb.fr" && typeof entry[2] === "string") {
          payloads.push(JSON.parse(entry[2]));
        }
      }
    } catch {
      return payloads;
    }
  }
  return payloads;
}

const isLegLike = (leg: unknown): boolean =>
  Array.isArray(leg) &&
  typeof leg[3] === "string" &&
  typeof leg[11] === "number" &&
  Array.isArray(leg[20]);

// The selected outbound sits in data[1] under a shifting index (it is wrapped
// with its airport pair and itinerary summary), so look for the option-shaped
// array — airline code + leg list — instead of pinning a position.
function findSelectedDetail(node: unknown, depth = 0): unknown[] | null {
  if (depth > 6 || !Array.isArray(node)) return null;
  if (
    typeof node[0] === "string" &&
    Array.isArray(node[2]) &&
    node[2].length > 0 &&
    node[2].every(isLegLike)
  ) {
    return node;
  }
  for (const child of node) {
    const found = findSelectedDetail(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export function parseReturnLegs(body: string): ReturnLegsPayload | null {
  for (const data of parseFramePayloads(body)) {
    if (!Array.isArray(data)) continue;
    const options = parseOptionsPayload(data);
    if (options.length === 0) continue;
    const detail = findSelectedDetail(data[1]);
    const legs = detail && Array.isArray(detail[2]) ? detail[2] : [];
    const selectedOutbound = legs
      .map(parseLeg)
      .filter((leg): leg is RawFlightLeg => leg !== null);
    if (selectedOutbound.length === 0) continue;
    return { selectedOutbound, options };
  }
  return null;
}
