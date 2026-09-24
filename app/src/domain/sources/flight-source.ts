import type {
  FlightSearchParams,
  FlightSourceResult,
  HealthStatus,
} from "./types";

export interface FlightSource {
  id: string;
  search(params: FlightSearchParams): Promise<FlightSourceResult>;
  health(): Promise<HealthStatus>;
}