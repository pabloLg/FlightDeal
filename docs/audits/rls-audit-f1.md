# RLS Audit — F1 (2026-09-24)

Resultado: **VERDE** — RLS multi-tenant correcto en 9/9 tablas.

## Inventario

| Tabla | RLS | Policies | Nota |
|---|---|---|---|
| profiles | ✅ | select/update owner | row creada por trigger signup |
| searches | ✅ | select/insert/update/delete owner | |
| search_executions | ✅ | select/insert/update/delete vía searches | |
| flight_options | ✅ | select/insert/update/delete vía searches | |
| flight_prices | ✅ | select/insert/update/delete vía options→searches | |
| price_stats_daily | ✅ | select/insert/update/delete vía searches | |
| alerts_edge | ✅ | select/insert/update/delete vía searches | |
| alert_dispatches | ✅ | select/insert vía alerts_edge→searches | |
| source_structure_versions | ✅ | sin grants (revoked anon/authenticated) | solo service_role |

Todos los checks usan `EXISTS (searches s WHERE s.profile_id = auth.uid())` → tenant correcto vía cadena search→option→price.

## Blindaje (bypass tests reales, REST)

| Test | Resultado |
|---|---|
| anon SELECT searches/profiles/flight_options | `[]` (sin datos) |
| anon INSERT searches | 401 `violates row-level security` |
| anon source_structure_versions | 401 `permission denied` |
| demo (owner) SELECT searches/options/prices | datos OK |
| user2 SELECT searches del demo (`profile_id=eq.demo`) | `[]` (aislado) |
| user2 SELECT flight_prices / alert_dispatches (datos demo) | `[]` (aislado) |
| user2 INSERT search con `profile_id` del demo | 403 `violates row-level security` |

## Fixes aplicados (migración `20260924102308_init.sql` + `seed.sql`)

1. `handle_new_user` → `security definer set search_path = public` — el trigger ahora inserta `profiles` en el contexto del service/owner (antes fallaba con `permission denied for table profiles` durante signup).
2. `seed.sql`: `auth.users` sin columna `locale` (eliminada en gotrue v2.196.0) y token columns (`confirmation_token`, `recovery_token`, `email_change`, `phone`) con `''` en vez de NULL — el scanner de GoTrue falla con NULL.
3. `seed.sql`: `ON CONFLICT` sobre `email` no es válido (índice parcial `users_email_partial_key`); sustituido por `ON CONFLICT DO NOTHING`.

Verificado: signup → auto-profile, sign-in demo, sign-in user2.