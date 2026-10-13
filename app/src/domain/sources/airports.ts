import raw from "./airports.json";

// Static IATA -> { city, name, country } table vendored from OurAirports (public
// domain). It lives in the server bundle only: pages resolve the codes they need
// and hand the card a small code -> city map, so the 600 KB dataset never ships
// to the client. Unknown codes fall back to the code itself in the UI.
type AirportInfo = { city: string; name: string; country: string };

const AIRPORTS = raw as Record<string, AirportInfo>;

export function airportInfo(code: string | null | undefined): AirportInfo | null {
  if (!code) return null;
  return AIRPORTS[code.trim().toUpperCase()] ?? null;
}

export function airportCity(code: string | null | undefined): string | null {
  return airportInfo(code)?.city ?? null;
}

export function airportName(code: string | null | undefined): string | null {
  return airportInfo(code)?.name ?? null;
}

// code -> city for exactly the codes a page is about to render. Resolved on the
// server so the cards stay free of the dataset.
export function cityMapFor(codes: Iterable<string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const code of codes) {
    const city = airportCity(code);
    if (city) map[code.toUpperCase()] = city;
  }
  return map;
}
