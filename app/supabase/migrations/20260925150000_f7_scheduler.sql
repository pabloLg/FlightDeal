-- F7 — Scheduler: tick interno en Postgres con leases.
-- Vercel Cron dispara POST /api/scheduler/tick → rpc scheduler_tick() →
-- retorna las ejecuciones a lanzar (con lease adquirido) o nada si otro
-- tick está en curso o no hay búsquedas debidas.

-- Release de leases expirados: ejecuciones que quedaron 'pending'/'running'
-- (cron murió a mitad) se marcan failed y se liberan para reintentar.
create or replace function public.release_expired_leases(
  p_grace interval default interval '15 minutes'
)
returns int
language plpgsql
security definer set search_path = public, pg_catalog
as $$
declare
  v_expired_at timestamptz := now() - p_grace;
  v_released int;
begin
  update public.search_executions
     set status = 'failed',
         lease_holder = null,
         lease_expires_at = null,
         finished_at = now(),
         error_message = 'lease_expired: released by tick (previous runner died)'
   where status in ('pending', 'running')
     and lease_expires_at is not null
     and lease_expires_at < v_expired_at;
  get diagnostics v_released = row_count;
  return v_released;
end;
$$;

-- Mark que respeta la lista de estados válidos.
create or replace function public.scheduler_tick(
  p_batch_size int default 10,
  p_lease_ttl interval default interval '10 minutes',
  p_min_interval interval default interval '30 minutes'
)
returns table (execution_id uuid, search_id uuid)
language plpgsql
security definer set search_path = public, pg_catalog
as $$
declare
  v_acquired boolean;
  v_cutoff timestamptz := now() - p_min_interval;
begin
  -- Un solo tick activo: si otro runner ya tomó el lock, no hacemos nada.
  select pg_try_advisory_xact_lock(hashtext('flight_deal_tracker_tick'))
    into v_acquired;
  if not coalesce(v_acquired, false) then
    return;
  end if;

  -- Limpia leases huérfanos antes de re-planificar.
  perform public.release_expired_leases(p_lease_ttl);

  -- Ejecuta cada search habilitado una vez por ventana (p_min_interval).
  -- Da prioridad a los que hace más tiempo que no se ejecutan.
  return query
  insert into public.search_executions as ex (search_id, status, lease_holder, lease_expires_at)
  select s.id, 'running', 'tick:' || txid_current()::text, now() + p_lease_ttl
    from public.searches s
   where s.enabled
     and not exists (
       select 1 from public.search_executions e
        where e.search_id = s.id
          and e.status in ('pending', 'running')
     )
     and not exists (
       select 1 from public.search_executions e
        where e.search_id = s.id
          and e.created_at > v_cutoff
          and e.status in ('completed', 'degraded', 'failed')
     )
   order by s.created_at, s.id
   limit p_batch_size
  returning ex.id, ex.search_id;
end;
$$;

grant execute on function public.release_expired_leases(interval) to authenticated, service_role;
grant execute on function public.scheduler_tick(int, interval, interval) to authenticated, service_role;