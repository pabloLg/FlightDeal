import type { FlightSource } from "./flight-source";
import type {
  FlightSearchParams,
  FlightOption,
  FlightSourceResult,
  HealthStatus,
} from "./types";

const AIRLINES = ["IB", "VY", "UX", "FR", "LH", "AF", "BA"];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function dekey(params: FlightSearchParams): string {
  return [params.origin, params.destination, params.departDate].join("|");
}

function buildOption(
  params: FlightSearchParams,
  day: number,
  seed: number,
): FlightOption {
  const base = 80 + (seed % 600);
  const price = Math.round(base + Math.sin(day * 7 + seed) * 15);
  const departAt = `${params.departDate}T06:${String((day * 13) % 60).padStart(2, "0")}:00`;
  const backAt = `${params.returnDate ?? params.departDate}T18:${String((day * 23) % 60).padStart(2, "0")}:00`;

  return {
    id: `mock-${params.origin}-${params.destination}-${params.departDate}-${day}`,
    price,
    currency: params.currency,
    outboundLegs: [
      {
        airline: AIRLINES[(seed + day) % AIRLINES.length],
        flightNumber: `${AIRLINES[(seed + day) % AIRLINES.length]}${100 + ((seed + day) % 899)}`,
        departAirport: params.origin,
        arriveAirport: params.destination,
        departAt,
        arriveAt: `${params.departDate}T09:30:00`,
        durationMin: 180 + ((seed + day) % 240),
      },
    ],
    inboundLegs:
      params.tripType === "round_trip" && params.returnDate
        ? [
            {
              airline: AIRLINES[(seed + day + 1) % AIRLINES.length],
              flightNumber: `${AIRLINES[(seed + day + 1) % AIRLINES.length]}${100 + ((seed + day + 1) % 899)}`,
              departAirport: params.destination,
              arriveAirport: params.origin,
              departAt: backAt,
              arriveAt: `${params.returnDate}T22:30:00`,
              durationMin: 200 + ((seed + day) % 220),
            },
          ]
        : [],
    airlines: [
      AIRLINES[(seed + day) % AIRLINES.length],
      ...(params.tripType === "round_trip"
        ? [AIRLINES[(seed + day + 1) % AIRLINES.length]]
        : []),
    ],
    totalDurationMin: 180 + ((seed + day) % 240),
  };
}

export class MockFlightSource implements FlightSource {
  readonly id = "mock";

  // deterministic per (origin, destination, departDate)
  async search(params: FlightSearchParams): Promise<FlightSourceResult> {
    await new Promise((resolve) => setTimeout(resolve, 400));

    // fixture route: "XXX" as destination simulates no results
    if (params.destination.toUpperCase() === "XXX") {
      return {
        options: [],
        currency: params.currency,
        structureVersion: 1,
        degraded: false,
        message: "no_flights",
      };
    }

    const seed = hashString(dekey(params));
    const options = Array.from({ length: 3 }, (_, i) =>
      buildOption(params, i + 1, seed),
    );

    return {
      options,
      currency: params.currency,
      structureVersion: 1,
      degraded: false,
    };
  }

  async health(): Promise<HealthStatus> {
    return { ok: true, structureVersion: 1 };
  }
}