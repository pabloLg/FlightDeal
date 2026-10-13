"use client";

import { OfferCard, type OfferCardData } from "./offer-card";
import { buildBookingUrl } from "@/lib/flight-display";
import type { CabinClass, FlightLeg, Stops, TripType } from "@/src/domain/sources/types";

export type Deal = {
  searchId: string;
  optionId: string;
  origin: string;
  destination: string;
  departDate: string | null;
  returnDate: string | null;
  tripType: TripType;
  cabinClass: CabinClass;
  stops: Stops;
  adults: number;
  price: number;
  currency: string;
  airlines: string[];
  legs: FlightLeg[];
  totalDurationMin: number | null;
  baseline: number | null;
  executedAt: string | null;
  availableDates?: string[];
  executionStatus?: string | null;
  /** IATA -> city, resolved on the server from the static dataset. */
  cities: Record<string, string>;
  isFavorite?: boolean;
};

export function DealCard({ deal, featured }: { deal: Deal; featured?: boolean }) {
  const first = deal.legs[0];
  const data: OfferCardData = {
    optionId: deal.optionId,
    searchId: deal.searchId,
    origin: deal.origin,
    destination: deal.destination,
    cities: deal.cities,
    departDate: deal.departDate,
    returnDate: deal.returnDate,
    tripType: deal.tripType,
    cabinClass: deal.cabinClass,
    adults: deal.adults,
    price: deal.price,
    currency: deal.currency,
    baseline: deal.baseline,
    airline: first?.airlineName || first?.airline || deal.airlines[0] || null,
    airlines: deal.airlines,
    outboundLegs: deal.legs,
    inboundLegs: [],
    bookingUrl: buildBookingUrl({
      origin: deal.origin,
      destination: deal.destination,
      depart_date: deal.departDate,
      return_date: deal.returnDate,
      trip_type: deal.tripType,
      cabin_class: deal.cabinClass,
      stops: deal.stops,
      adults: deal.adults,
    }),
    executedAt: deal.executedAt,
    availableDates: deal.availableDates,
    executionStatus: deal.executionStatus,
    featured,
    isFavorite: deal.isFavorite,
  };
  return <OfferCard data={data} />;
}
