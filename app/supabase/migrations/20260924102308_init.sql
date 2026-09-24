-- profiles: one per auth user, created automatically on signup
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  currency text not null default 'EUR',
  retention_keep_aggregates boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- searches: user-defined flight searches
create table public.searches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  origin text not null,
  destination text not null,
  depart_date date,
  return_date date,
  trip_type text not null default 'round_trip' check (trip_type in ('round_trip', 'one_way')),
  cabin_class text not null default 'economy' check (cabin_class in ('economy', 'premium_economy', 'business', 'first')),
  stops text not null default 'any' check (stops in ('any', 'non_stop')),
  adults int not null default 1 check (adults >= 1 and adults <= 9),
  enabled boolean not null default true,
  alert_threshold_eur numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- search_executions: one row per run, carries state, rate-limit and leases
create table public.search_executions (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches (id) on delete cascade,
  scheduled_start timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'degraded', 'failed')),
  error_message text,
  structure_check_passed boolean,
  raw_result jsonb not null default '{}'::jsonb,
  ratelimit_remaining int,
  lease_holder text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- flight_options: deduped flight results for a search execution
create table public.flight_options (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches (id) on delete cascade,
  execution_id uuid not null references public.search_executions (id) on delete cascade,
  dedupe_key text not null,
  outbound_legs jsonb not null default '[]'::jsonb,
  inbound_legs jsonb not null default '[]'::jsonb,
  price_eur numeric(10, 2) not null check (price_eur >= 0),
  currency text not null default 'EUR',
  airlines jsonb not null default '[]'::jsonb,
  total_duration_min int,
  created_at timestamptz not null default now()
);

-- flight_prices: point-in-time price snapshots (TTL 3 months, purged by retention)
create table public.flight_prices (
  id uuid primary key default gen_random_uuid(),
  flight_option_id uuid not null references public.flight_options (id) on delete cascade,
  price_eur numeric(10, 2) not null check (price_eur >= 0),
  currency text not null default 'EUR',
  observed_at timestamptz not null default now()
);

-- price_stats_daily: daily aggregates, kept indefinitely
create table public.price_stats_daily (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches (id) on delete cascade,
  stats_date date not null,
  min_price_eur numeric(10, 2),
  max_price_eur numeric(10, 2),
  avg_price_eur numeric(10, 2),
  observations int not null default 0,
  created_at timestamptz not null default now(),
  unique (search_id, stats_date)
);

-- alerts_edge: per-search alert thresholds
create table public.alerts_edge (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches (id) on delete cascade,
  threshold_eur numeric(10, 2) not null check (threshold_eur >= 0),
  provider text not null default 'telegram' check (provider in ('telegram')),
  cooldown_hours int not null default 24 check (cooldown_hours >= 1),
  last_fired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (search_id, provider, threshold_eur)
);

-- alert_dispatches: record of each alert send
create table public.alert_dispatches (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts_edge (id) on delete cascade,
  flight_option_id uuid references public.flight_options (id) on delete set null,
  price_eur numeric(10, 2) not null,
  dispatched_at timestamptz not null default now(),
  status text not null default 'dispatched'
    check (status in ('dispatched', 'delivered', 'failed'))
);

-- source_structure_versions: structure-guard versioning (fail-closed data)
create table public.source_structure_versions (
  id uuid primary key default gen_random_uuid(),
  source_id text not null default 'google_flights_scraper',
  version int not null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (source_id, version)
);

-- keep profiles updated_at fresh
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger searches_set_updated_at
  before update on public.searches
  for each row execute function public.set_updated_at();

create trigger alerts_edge_set_updated_at
  before update on public.alerts_edge
  for each row execute function public.set_updated_at();

-- auto-create a profile row on signup
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- indexes for the access patterns used by the app
create index searches_profile_id_idx on public.searches (profile_id);
create index search_executions_search_id_idx on public.search_executions (search_id);
create index search_executions_status_idx on public.search_executions (status);
create index search_executions_lease_expires_at_idx on public.search_executions (lease_expires_at);
create index flight_options_search_id_idx on public.flight_options (search_id);
create index flight_options_execution_id_idx on public.flight_options (execution_id);
create unique index flight_options_dedupe_idx on public.flight_options (search_id, dedupe_key);
create index flight_prices_flight_option_id_idx on public.flight_prices (flight_option_id);
create index flight_prices_observed_at_idx on public.flight_prices (observed_at);
create index price_stats_daily_search_id_idx on public.price_stats_daily (search_id);
create index alerts_edge_search_id_idx on public.alerts_edge (search_id);
create index alert_dispatches_alert_id_idx on public.alert_dispatches (alert_id);

-- RLS: tenant isolation from day 1 (each user only sees their own rows)
alter table public.profiles enable row level security;
alter table public.searches enable row level security;
alter table public.search_executions enable row level security;
alter table public.flight_options enable row level security;
alter table public.flight_prices enable row level security;
alter table public.price_stats_daily enable row level security;
alter table public.alerts_edge enable row level security;
alter table public.alert_dispatches enable row level security;
alter table public.source_structure_versions enable row level security;

-- profiles: owner manages their own row only (row is created by the signup trigger)
create policy "profiles_owner_select" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

create policy "profiles_owner_update" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- searches: owners manage their own searches
create policy "searches_owner_select" on public.searches
  for select to authenticated
  using (auth.uid() = profile_id);

create policy "searches_owner_insert" on public.searches
  for insert to authenticated
  with check (auth.uid() = profile_id);

create policy "searches_owner_update" on public.searches
  for update to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "searches_owner_delete" on public.searches
  for delete to authenticated
  using (auth.uid() = profile_id);

-- search_executions: reachable only through owned searches
create policy "search_executions_owner_select" on public.search_executions
  for select to authenticated
  using (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

create policy "search_executions_owner_insert" on public.search_executions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

create policy "search_executions_owner_update" on public.search_executions
  for update to authenticated
  using (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

create policy "search_executions_owner_delete" on public.search_executions
  for delete to authenticated
  using (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

-- flight_options: reachable only through owned searches
create policy "flight_options_owner_select" on public.flight_options
  for select to authenticated
  using (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

create policy "flight_options_owner_insert" on public.flight_options
  for insert to authenticated
  with check (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

create policy "flight_options_owner_update" on public.flight_options
  for update to authenticated
  using (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

create policy "flight_options_owner_delete" on public.flight_options
  for delete to authenticated
  using (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

-- flight_prices: reachable through owned flight options
create policy "flight_prices_owner_select" on public.flight_prices
  for select to authenticated
  using (
    exists (
      select 1 from public.flight_options o
      join public.searches s on s.id = o.search_id
      where o.id = flight_option_id and s.profile_id = auth.uid()
    )
  );

create policy "flight_prices_owner_insert" on public.flight_prices
  for insert to authenticated
  with check (
    exists (
      select 1 from public.flight_options o
      join public.searches s on s.id = o.search_id
      where o.id = flight_option_id and s.profile_id = auth.uid()
    )
  );

create policy "flight_prices_owner_update" on public.flight_prices
  for update to authenticated
  using (
    exists (
      select 1 from public.flight_options o
      join public.searches s on s.id = o.search_id
      where o.id = flight_option_id and s.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.flight_options o
      join public.searches s on s.id = o.search_id
      where o.id = flight_option_id and s.profile_id = auth.uid()
    )
  );

create policy "flight_prices_owner_delete" on public.flight_prices
  for delete to authenticated
  using (
    exists (
      select 1 from public.flight_options o
      join public.searches s on s.id = o.search_id
      where o.id = flight_option_id and s.profile_id = auth.uid()
    )
  );

-- price_stats_daily: only owners may read their aggregates
create policy "price_stats_daily_owner_select" on public.price_stats_daily
  for select to authenticated
  using (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

create policy "price_stats_daily_owner_insert" on public.price_stats_daily
  for insert to authenticated
  with check (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

create policy "price_stats_daily_owner_update" on public.price_stats_daily
  for update to authenticated
  using (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

create policy "price_stats_daily_owner_delete" on public.price_stats_daily
  for delete to authenticated
  using (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

-- alerts_edge: owners manage their alert edges
create policy "alerts_edge_owner_select" on public.alerts_edge
  for select to authenticated
  using (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

create policy "alerts_edge_owner_insert" on public.alerts_edge
  for insert to authenticated
  with check (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

create policy "alerts_edge_owner_update" on public.alerts_edge
  for update to authenticated
  using (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

create policy "alerts_edge_owner_delete" on public.alerts_edge
  for delete to authenticated
  using (
    exists (
      select 1 from public.searches s
      where s.id = search_id and s.profile_id = auth.uid()
    )
  );

-- alert_dispatches: owners read their dispatch history
create policy "alert_dispatches_owner_select" on public.alert_dispatches
  for select to authenticated
  using (
    exists (
      select 1 from public.alerts_edge ae
      join public.searches s on s.id = ae.search_id
      where ae.id = alert_id and s.profile_id = auth.uid()
    )
  );

create policy "alert_dispatches_owner_insert" on public.alert_dispatches
  for insert to authenticated
  with check (
    exists (
      select 1 from public.alerts_edge ae
      join public.searches s on s.id = ae.search_id
      where ae.id = alert_id and s.profile_id = auth.uid()
    )
  );

-- source_structure_versions and alert dispatch status updates are done
-- server-side (service role); authenticated users get no direct access.

revoke all on table public.source_structure_versions from anon, authenticated;