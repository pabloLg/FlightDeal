export type TripType = "round_trip" | "one_way";
export type CabinClass = "economy" | "premium_economy" | "business" | "first";
export type Stops = "any" | "non_stop";

export interface FlightSearchParams {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  tripType: TripType;
  cabinClass: CabinClass;
  stops: Stops;
  adults: number;
  currency: string;
  /** ± days window around departDate/returnDate to explore (0 = exact dates). */
  flexDays?: number;
}

export interface FlightLeg {
  airline: string;
  /** Full carrier name when the source exposes it (Google leg[22][3]). */
  airlineName?: string;
  flightNumber: string;
  departAirport: string;
  arriveAirport: string;
  departAt: string;
  arriveAt: string;
  durationMin: number;
}

export interface FlightOptionBookingUrl {
  source: string;
  url: string;
}

// Per-provider purchase link for one option (fase booking). `get` links open
// directly; `post` links (SerpAPI/Google handoff) carry an opaque form body
// that reproduces booking_request.post_data byte-for-byte.
export interface FlightOptionBookingLink {
  provider: string;
  providerType?: string;
  price: number;
  currency: string;
  url: string;
  method: "get" | "post";
  postData?: string;
}

export interface FlightOption {
  id: string;
  price: number;
  currency: string;
  outboundLegs: FlightLeg[];
  inboundLegs: FlightLeg[];
  airlines: string[];
  totalDurationMin: number;
  /** Booking URL when a source exposes it directly for this option. */
  bookingUrl?: string;
  /** Known booking URLs from different sources for the same itinerary (domain-only, not persisted). */
  bookingUrls?: FlightOptionBookingUrl[];
  /** Per-provider purchase links fetched at execution time (persisted). */
  bookingLinks?: FlightOptionBookingLink[];
}

export interface FlightSourceResult {
  options: FlightOption[];
  currency: string;
  structureVersion: number;
  degraded: boolean;
  message?: string;
}

export interface HealthStatus {
  ok: boolean;
  structureVersion?: number;
  message?: string;
}