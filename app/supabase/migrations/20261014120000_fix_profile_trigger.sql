-- Un usuario nuevo no podía crear búsquedas: el INSERT reventaba con
-- "searches_profile_id_fkey" porque no tenía fila en public.profiles.
--
-- La fila de profiles solo la creaba el trigger on_auth_user_created
-- (20260924102308_init.sql). Si ese trigger falta, está deshabilitado o se
-- borró en la BD hospedada, el usuario se autentica pero se queda sin perfil
-- y cualquier escritura que lo referencia falla.
--
-- Todo aquí es idempotente: se puede ejecutar las veces que haga falta.

-- 1. Recrear la función que da de alta el perfil (definición idéntica a la
--    original: security definer + search_path fijado, conflicto ignorado).
create or replace function public.handle_new_user()
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

-- 2. Recrear el trigger en auth.users.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Backfill: los usuarios que ya se quedaron sin perfil (incluido el que
--    reportó el error) lo recuperan aquí.
insert into public.profiles (id, email)
select id, coalesce(email, '') from auth.users
on conflict (id) do nothing;

-- 4. Red de seguridad: que cada usuario pueda crear su propia fila de perfil.
--    Sin esta policy la app no puede remediar un trigger ausente, porque
--    profiles solo tenía SELECT y UPDATE. El check limita el INSERT a la fila
--    propia, así que no se cruza ningún tenant.
drop policy if exists "profiles_owner_insert" on public.profiles;

create policy "profiles_owner_insert" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);
