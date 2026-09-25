# F4 Historical Audit — rollup + TTL (2026-09-25)

Resultado: **VERDE** — rollup diario correcto, TTL de detalle, flag `retention_keep_aggregates` respeta la conservación de tendencias.

## Qué se auditó

Migración `20260925120910_f4_historical.sql`:

- `refresh_daily_stats()` trigger `AFTER INSERT` en `flight_prices` → upsert en `price_stats_daily` (min/avg/max/observations por search+day), recomputado desde todo el detalle del día e independiente del orden de inserción.
- `run_retention(age)` TTL: purga `flight_prices` con `observed_at < now() - age` (default 3 meses). Conserva `price_stats_daily` salvo que el profile tenga `retention_keep_aggregates = false` (purgar todo).
- Seed demo: `retention_keep_aggregates = true` (el demo conserva tendencias para la demo/UI).

## Checks (ejecutados contra Supabase local, rol postgres, `ON_ERROR_STOP=1`)

| Check | SQL | Resultado |
|---|---|---|
| Rollup por día | insert 3 snapshots (2 días, 2 opciones) → `price_stats_daily` | 2 filas: día1 min95.00/max110.50/avg102.75/obs2 · día2 min/max/avg recomputado |
| Recomputo en upsert | 4º insert mismo día → obs 3→4, avg recalculado (81.00→82.00) | ✅ min/max/avg/obs coherentes |
| TTL no destructivo (30 días) | `run_retention(interval '30 days')` | purged=0, detalle intacto |
| TTL 3 meses | snapshot a `now()-4months` + 1 reciente → `run_retention()` | purga solo el viejo (2/3), agregados demo intactos (2 filas) |
| Flag false (purgar todo) | profile `retention_keep_aggregates=false` con search+option+price+stats → `run_retention()` | agregado del profile purgado, demo conserva los suyos |
| Detalle de hoy conservado | TTL con snapshot reciente | 1 fila reciente permanece |

## Hitos

- demo profile creado por trigger `handle_new_user` antes que el seed; `on conflict do nothing` no actualizaba el flag → se cambió a `on conflict (id) do update set ...`. (Causa: el profile demo ya existía al correr el seed.)

## UI

`/searches/[id]` muestra "Histórico de precios": fila por día con barra CSS de mínimo y `min – max EUR · media X` (sin librerías). Datos de `price_stats_daily` vía `supabase.from("price_stats_daily").eq("search_id", id)` (RLS owner).