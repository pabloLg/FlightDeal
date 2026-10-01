-- F10 (produccion) — el reaper solo miraba lease_expires_at, asi que una
-- ejecucion que nacio sin lease (retry manual: el endpoint inserta status
-- 'pending' sin lease) y cuyo runner murio a mitad de scrape quedaba en
-- 'running' para siempre, con canRetry respondiendo execution_in_flight y el
-- search bloqueado de por vida. La edad cubre cualquier runner futuro que
-- olvide tomar lease; el grace (15 min) sigue muy por encima del tope de
-- invocacion (60 s), asi que una corrida sana nunca se toca.
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
     and (
       (lease_expires_at is not null and lease_expires_at < v_expired_at)
       or created_at < v_expired_at
     );
  get diagnostics v_released = row_count;
  return v_released;
end;