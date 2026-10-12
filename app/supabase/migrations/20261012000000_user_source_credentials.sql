-- Credenciales por usuario: cada perfil guarda sus propias claves de SerpAPI
-- e Ignav. El cifrado (AES-256-GCM) y la clave maestra viven en el servidor;
-- aqui solo se almacena el secreto cifrado.
--
-- RLS: cada usuariolee y escribe unicamente sus filas. Las politicas son las
-- mismas que el resto de tablas de usuario (perfil duenno). El servidor lee
-- con service_role para resolver las credenciales de cada ejecucion.
create table if not exists public.user_source_credentials (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('serpapi', 'ignav')),
  secret_encrypted text not null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, provider)
);

alter table public.user_source_credentials enable row level security;

create policy "user_source_credentials_owner_select" on public.user_source_credentials
  for select to authenticated
  using (auth.uid() = profile_id);

create policy "user_source_credentials_owner_insert" on public.user_source_credentials
  for insert to authenticated
  with check (auth.uid() = profile_id);

create policy "user_source_credentials_owner_update" on public.user_source_credentials
  for update to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "user_source_credentials_owner_delete" on public.user_source_credentials
  for delete to authenticated
  using (auth.uid() = profile_id);
