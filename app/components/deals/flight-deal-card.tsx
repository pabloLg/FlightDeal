"use client";

import { OfferCard, type OfferCardData } from "./offer-card";
import type {
  CabinClass,
  FlightLeg,
  FlightOptionBookingLink,
  TripType,
} from "@/src/domain/sources/types";

interface DealLike {
  id: string;
  price: number;
  currency: string;
  outboundLegs: FlightLeg[];
  inboundLegs: FlightLeg[];
  bookingUrl?: string | null;
  source?: string | null;
  bookingLinks?: FlightOptionBookingLink[] | null;
  executedAt?: string | null;
}

export function FlightDealCard({
  deal,
  isBestPrice,
  searchId,
  searchMeta,
  cities,
  isFavorite,
  availableDates,
  executedAt,
  executionStatus,
}: {
  deal: DealLike;
  isBestPrice?: boolean;
  searchId: string;
  searchMeta: {
    origin: string;
    destination: string;
    departDate: string | null;
    returnDate: string | null;
    tripType: string;
    cabinClass: string;
    adults: number;
  };
  /** IATA -> city, resolved on the server from the static dataset. */
  cities: Record<string, string>;
  isFavorite?: boolean;
  availableDates?: string[];
  executedAt?: string | null;
  executionStatus?: string | null;
}) {
  const first = deal.outboundLegs[0];
  const data: OfferCardData = {
    optionId: deal.id,
    searchId,
    origin: searchMeta.origin,
    destination: searchMeta.destination,
    cities,
    departDate: searchMeta.departDate,
    returnDate: searchMeta.returnDate,
    tripType: searchMeta.tripType as TripType,
    cabinClass: searchMeta.cabinClass as CabinClass,
    adults: searchMeta.adults,
    price: deal.price,
    currency: deal.currency,
    baseline: null,
    airline: first?.airlineName || first?.airline || null,
    airlines: [first?.airlineName || first?.airline].filter(Boolean) as string[],
    outboundLegs: deal.outboundLegs,
    inboundLegs: deal.inboundLegs,
    bookingUrl: deal.bookingUrl ?? null,
    providerLinks: deal.bookingLinks ?? undefined,
    source: deal.source ?? null,
    executedAt: executedAt ?? deal.executedAt ?? null,
    availableDates,
    executionStatus,
    isBestPrice,
    isFavorite,
  };
  return <OfferCard data={data} />;
}
