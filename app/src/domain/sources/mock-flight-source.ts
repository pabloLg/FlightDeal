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

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

  // deterministic per (origin, destination, departDate) and flex window
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

    const flex = params.flexDays ?? 0;
    // One option per day across the flex window (or 3 options on the exact date).
    const offsets = flex > 0 ? range(-flex, flex) : [1, 2, 3];
    const seed = hashString(
      [params.origin, params.destination, params.departDate].join("|"),
    );
    const options = offsets.map((day) => {
      const departDate =
        flex > 0 ? addDays(params.departDate, day) : params.departDate;
      const returnDate =
        flex > 0 && params.returnDate
          ? addDays(params.returnDate, day)
          : params.returnDate;
      return { ...params, departDate, returnDate, flexDays: undefined };
    }).map((p, i) => buildOption(p, i + 1, seed + i));

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

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}