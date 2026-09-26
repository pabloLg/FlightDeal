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
  flightNumber: string;
  departAirport: string;
  arriveAirport: string;
  departAt: string;
  arriveAt: string;
  durationMin: number;
}

export interface FlightOption {
  id: string;
  price: number;
  currency: string;
  outboundLegs: FlightLeg[];
  inboundLegs: FlightLeg[];
  airlines: string[];
  totalDurationMin: number;
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