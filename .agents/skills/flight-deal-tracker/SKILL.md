---
name: flight-deal-tracker
description: 'Project memory for the Flight Deal Tracker app: frozen decisions, architecture, data model, phases, commands. Use for ANY task on this codebase before writing code/research to stay consistent with the frozen plan (docs/plans/FLIGHT-DEAL-TRACKER.md).'
---

# Flight Deal Tracker — Memoria del proyecto

Fuente de verdad del plan ejecutable: `docs/plans/FLIGHT-DEAL-TRACKER.md` (con las fases F1–F10 y criterios de aceptación).

## Decisiones congeladas (resumen ejecutivo)

| Área | Decisión |
|---|---|
| Stack | Next.js (App Router) + TypeScript + React + Tailwind + Supabase + Vercel |
| Backend | Sin backend separado. Route Handlers + Server Actions. Scheduler: tick interno en Postgres + Vercel Cron |
| Fuentes | `GoogleFlightsScraperSource` (PRINCIPAL), `MockFlightSource` (dev/test), SerpAPI (F8 fallback), Kiwi (F8 2ª). NO Amadeus |
| TFS | Server-side determinista, `hl=es&gl=ES&curr=EUR` en MVP |
| Cookies | Consent-only anónimas (SOCS). Prohibido login/NID |
| Bloqueo | Fail-closed + `POST /admin/sources/retry` manual auditado. Sin evasión |
| Retención | Detalle 3 meses TTL; `price_stats_daily` indefinido; flag `retention.keep_aggregates=false` |
| Alertas | Provider pattern; Telegram primero; bot único |
| Concurrencia | Leases (tick) en Postgres |
| Seguridad | RLS multi-tenant día 1 |

## Arquitectura

- Interfaz `FlightSource`: `search(params) → FlightSourceResult`, `health() → HealthStatus`.
- Scraper componenteizado: URL builder / navigation / session / parser / normalizer / structure-guard / fixtures.
- Modelo de datos: profiles, searches, search_executions (estado+leases+ratelimit), flight_options, flight_prices (TTL), price_stats_daily, alerts_edge, alert_dispatches, source_structure_versions.

## Rutas / archivos clave esperados

- `docs/plans/FLIGHT-DEAL-TRACKER.md` — plan congelado.
- `src/domain/sources/FlightSource.ts` — interfaz.
- `src/domain/sources/GoogleFlightsScraperSource.ts` — scraper.
- `src/domain/sources/MockFlightSource.ts` — dev/test.
- `.agents/skills/google-flights-scraper/` — skill del scraper.
- Supabase migrations en carpeta de migraciones (por confirmar al arrancar F1).

## Comandos estándar

Determinados en F1. Referente: `npm run lint`, `npm run typecheck` (o `tsc --noEmit`), `npm test`. Actualizar `AGENTS.md` cuando se definan.

## Estado actual

**F1 (Foundation) ✅ completado 2026-09-24**:
- Supabase local OK (CLI, Docker), migración `20260924102308_init.sql` + seed aplicados, `supabase db reset` reproduce limpio.
- RLS audit 9/9 verde (`docs/audits/rls-audit-f1.md`). Trigger `handle_new_user` es `security definer set search_path = public`.
- Auth E2E UI OK (login demo, signup con profile auto, signout, `/dashboard` protegido → `/login?next=`).
- CI GitHub verde (lint, typecheck, test, build, Node 22). `npm ci` estricto: lockfile regenerado bajo Node 22. Ojo: `LayoutProps`/`PageProps` de Next 16 requieren `.next/types` generados — no usar en código que `tsc --noEmit` revisa antes del build.
- Usuario seed: `demo@example.com` / `DemoPass123!` (creado por `supabase db reset`).

**F2a (Search + Domain) ✅ completado 2026-09-24**:
- Dominio en `src/domain/sources/` (una vez dentro de `app/`): `types.ts`, `FlightSource.ts`, `MockFlightSource.ts` (hash determinista, fixture `XXX` → `no_flights`) + tests vitest.
- CRUD searches: Server Actions en `app/actions/search.ts` + UI en `components/search/searches-view.tsx` (cliente).
- Runner: `app/api/searches/[id]/route.ts` (POST run async 202 + GET status, runtime nodejs). Ejecución mock end-to-end: `pending→running→completed`, upsert de `flight_options` (dedupe `search_id,dedupe_key`) + snapshot `flight_prices`. Poll en cliente: GET cada 600ms hasta `completed|degraded|failed`.
- E2E UI validado: crear/editar/desactivar/eliminar search, ejecutar con poll, `no_flights` → `completed` con mensaje. Checks locales verdes (lint, typecheck, 6 tests, build), CI GitHub OK. Commit `db4248d`.
- Advertencia: el `useEffect` de cierre en `EditSearchForm` compara `state !== emptyState` (referencia), no `state &&`, para no cerrar el form al montar.

## Fases pendientes por orden

F2a Search+Domain → F2b Scraper (phase-gate) → F3 Results → F4 Historical → F5 Alerts → F6 Telegram → F7 Scheduler → F8 Fallback API → F9 Flexible search → F10 Optimization.

## Normas de trabajo

- Leer este skill y el plan antes de tocar código.
- No inventar decisiones: si algo no está en el plan congelado, consultar al usuario.
- Los tests no deben depender de red (fixtures + MockFlightSource).