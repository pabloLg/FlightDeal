-- Favoritos: una tarjeta marcada se fija al principio de la lista. La fila es
-- un snapshot del itinerario, no una referencia viva: flight_options se recrea
-- en cada ejecucion (su id cambia), asi que se copian los datos al marcar y el
-- enlace a la opcion queda laxo (on delete set null) solo para trazabilidad.
-- Identidad estable: (profile_id, search_id, dedupe_key).
create table if not exists public.favorite_deals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  search_id uuid not null references public.searches (id) on delete cascade,
  flight_option_id uuid references public.flight_options (id) on delete set null,
  dedupe_key text not null,
  origin text not null,
  destination text not null,
  depart_date date,
  return_date date,
  price_eur numeric(10, 2) not null check (price_eur >= 0),
  currency text not null default 'EUR',
  outbound_legs jsonb not null default '[]'::jsonb,
  inbound_legs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (profile_id, search_id, dedupe_key)
);

create index if not exists favorite_deals_profile_idx
  on public.favorite_deals (profile_id, created_at desc);

alter table public.favorite_deals enable row level security;

create policy "favorite_deals_owner_select" on public.favorite_deals
  for select to authenticated
  using (auth.uid() = profile_id);

create policy "favorite_deals_owner_insert" on public.favorite_deals
  for insert to authenticated
  with check (auth.uid() = profile_id);

create policy "favorite_deals_owner_update" on public.favorite_deals
  for update to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "favorite_deals_owner_delete" on public.favorite_deals
  for delete to authenticated
  using (auth.uid() = profile_id);
