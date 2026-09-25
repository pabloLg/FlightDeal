# F7 — Scheduler · Auditoría (verificado 2026-09-25)

## Entregables

### Migración `supabase/migrations/20260925150000_f7_scheduler.sql`
- `public.scheduler_tick(p_batch_size int default 10, p_lease_ttl interval default '10 minutes', p_min_interval interval default '30 minutes') → table(execution_id uuid, search_id uuid)`
  - **security definer set search_path** (bypass RLS multicapa, solo expone ids).
  - **Advisory lock** `pg_try_advisory_xact_lock(hashtext('flight_deal_tracker_tick'))`: un solo tick activo; si otro runner ya corre → no hace nada (sin doble ejecución).
  - Limpia leases huérfanos con `release_expired_leases` antes de planificar.
  - Selecciona `searches` con `enabled = true`, sin ejecución `pending`/`running` ni ejecución terminal en la ventana `p_min_interval`.
  - Inserta `search_executions` como `running` con `lease_holder = 'tick:<txid>'` y `lease_expires_at = now() + p_lease_ttl`.
  - Devuelve las ejecuciones a lanzar; prioriza los searches más antiguos.
- `public.release_expired_leases(p_grace interval default '15 minutes') → int`
  - Ejecuciones `pending`/`running` cuyo `lease_expires_at` venció hace > gracia → `failed` con `error_message = 'lease_expired: released by tick (previous runner died)'`, lease liberado. Evita corredores zombie.
- Grants: `authenticated`, `service_role`.

### Endpoint `app/api/scheduler/tick/route.ts` (Vercel Cron)
- Auth por `Authorization: Bearer <CRON_SECRET>` (env local `local-cron-secret-01`).
- Llama `rpc scheduler_tick`, ejecuta cada resultado (loose coupling, fire-and-forget) con `runSearchExecution`.
- Usa `createAdminClient` (service_role) para operar sin sesión de usuario.

### Refactor `app/api/searches/[id]/route.ts`
- La lógica de ejecución (`runExecution`, `evaluateAndDispatchAlerts`, tipos) se movió a
  `src/domain/search/execute-search.ts`, reutilizada por el endpoint manual y el cron.
- `mark()` ahora limpia `lease_holder`/`lease_expires_at` al escribir cualquier estado (release explícito por el runner).

### Config
- `vercel.json` → cron `0 6 * * *` → `POST /api/scheduler/tick`.
- `.env` / `.env.example` → `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.
- `lib/supabase/admin.ts` → cliente service_role.

### F6-prep (UI)
- `app/searches/[id]/page.tsx`: nueva sección **Alertas** — historial de `alert_dispatches`
  (fecha, precio, umbral del edge, estado). Valida el contrato que consumirá el bot de F6.

## Verificación

### 1. Sin doble ejecución (leases)
```
tick1 → 1 ejecución creada (running, lease tick:1651)
tick2 inmediato → 0 ejecuciones (hay pending/running activa)
```

### 2. Release de leases
Lease expirado hace > gracia → `release_expired_leases` lo marca `failed`:
```
UPDATE 1 ; released | 1 ; status=failed · error=lease_expired...
```
Lease vencido pero dentro de la gracia → NO se libera (count 0). Correcto.

### 3. Flujo E2E (cron → ejecución → alerta)
- Seed: search `00000000-0000-0000-0000-000000000002` MAD→BCN, `alert_threshold_eur=80`.
- Backdate de ejecuciones previas (ventana 30 min) → `POST /api/scheduler/tick` con header cron.
- Resultado: `{"executions":1}`, ejecución `completed` con 3 precios (mock determinista), lease liberado.
- Alerta disparada por F5: `alert_dispatches` = 1, `price_eur=60.00` (60 ≤ 80).
- UI `/searches/[id]` → sección **Alertas**: `25/9/2026, 14:56:59 · 60.00 EUR · umbral 80.00 · Enviada`.

## Suite local
- `npm test`: **32/32 passed**
- `npm run typecheck`: OK
- `npm run lint`: OK
- `npm run build`: OK (rutas incluyen `/api/scheduler/tick` ƒ)
- Confirmar CI GitHub tras push (`f7-scheduler`).

## Puntos anotados
- Schedule actual en Vercel Hobby: **1 tick/día** (limitación D12). Cada tick respeta `p_min_interval`
  para no re-ejecutar búsquedas reciente.
- Concurrencia real delegada a leashes por búsqueda; el advisory lock cubre la "doble ejecución" del tick
  si dos instancias Vercel coinciden.