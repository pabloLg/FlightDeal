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

## Fases pendientes por orden

F1 Foundation → F2a Search+Domain → F2b Scraper (phase-gate) → F3 Results → F4 Historical → F5 Alerts → F6 Telegram → F7 Scheduler → F8 Fallback API → F9 Flexible search → F10 Optimization.

## Normas de trabajo

- Leer este skill y el plan antes de tocar código.
- No inventar decisiones: si algo no está en el plan congelado, consultar al usuario.
- Los tests no deben depender de red (fixtures + MockFlightSource).