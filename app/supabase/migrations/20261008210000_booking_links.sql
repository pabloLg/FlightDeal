-- Fase booking: per-provider purchase links fetched at execution time
-- (top-3 cheapest per option). Nullable so old rows stay valid; the runner
-- writes it on every upsert, the results page renders one button per link
-- plus the generic Google Flights link as fallback.
alter table public.flight_options
  add column if not exists booking_links jsonb;
