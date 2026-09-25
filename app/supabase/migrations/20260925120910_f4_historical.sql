-- F4 Historical: daily price rollup (per search) + retention TTL.
-- - price_stats_daily is kept indefinitely for trends, unless the profile
--   opts out with retention_keep_aggregates = false ("purge everything").

-- 1) Daily rollup: after each price snapshot insert, refresh the aggregate
--    row for that (search_id, day). Cheap enough at this app's volume, and
--    always consistent regardless of insert order / dedupe upserts.
create or replace function public.refresh_daily_stats()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_search_id uuid;
  v_day date;
begin
  select o.search_id into v_search_id
    from public.flight_options o
   where o.id = new.flight_option_id;

  if v_search_id is null then
    return new;
  end if;

  v_day := new.observed_at::date;

  insert into public.price_stats_daily
    (search_id, stats_date, min_price_eur, max_price_eur, avg_price_eur, observations)
  select v_search_id, v_day, min(p.price_eur), max(p.price_eur),
         round(avg(p.price_eur), 2), count(*)
    from public.flight_prices p
    join public.flight_options o on o.id = p.flight_option_id
   where o.search_id = v_search_id
     and p.observed_at::date = v_day
  on conflict (search_id, stats_date) do update set
    min_price_eur = excluded.min_price_eur,
    max_price_eur = excluded.max_price_eur,
    avg_price_eur = excluded.avg_price_eur,
    observations = excluded.observations;

  return new;
end;
$$;

create trigger flight_prices_refresh_daily_stats
  after insert on public.flight_prices
  for each row execute function public.refresh_daily_stats();

-- 2) Retention: purge price detail (flight_prices) older than TTL (3 months).
--    Aggregates survive unless the owner opted out (retention_keep_aggregates
--    = false), in which case their entire price_stats_daily is purged.
create or replace function public.run_retention(age interval default interval '3 months')
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  purged int := 0;
begin
  delete from public.flight_prices
   where observed_at < now() - age;
  get diagnostics purged = row_count;

  delete from public.price_stats_daily d
    using public.searches s
    join public.profiles p on p.id = s.profile_id
   where d.search_id = s.id
     and p.retention_keep_aggregates = false;

  return purged;
end;
$$;