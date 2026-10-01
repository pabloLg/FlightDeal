# AGENTS.md

## Stack

Next.js (App Router, **v16 — ver breaking changes en `node_modules/next/dist/docs/`**) + TypeScript + React 19 + Tailwind CSS v4 + shadcn (`base-nova`/Base UI) + Supabase (PostgreSQL/Auth) + Vercel.

## Fase actual

Plan congelado en `docs/plans/FLIGHT-DEAL-TRACKER.md`. **F1–F5, F7, F8, F9 y F2c ✅ completados** (F2c el 2026-09-28: wiring real del scraper Google con `playwright-core` + click-through del tramo de regreso vía RPC `GetShoppingResults`; Chromium se instala aparte y en self-hosted se apunta con `CHROMIUM_PATH`). **F10 slices 1-3 ✅**: métricas (`ms` por fuente, `durationMs` por ejecución) en `raw_result` + tick que espera las ejecuciones (45 s) porque Vercel mata el fire-and-forget; Chromium en Vercel vía `@sparticuz/chromium`; `run_retention()` ejecutada desde el tick y `POST /api/admin/sources/retry` (D6, `Bearer CRON_SECRET`, auditoría en `search_executions`). Siguiente: verificación en deploy real de F10 y luego **F6** (Telegram). Docker engine OK (VHDX en `E:\DockerDesktop\wsl`).

Chromium (`npx playwright install chromium`, cache en `%LOCALAPPDATA%\ms-playwright`) es requisito para `FLIGHT_SOURCES=google_flights`; sin navegador la fuente degrada y la cadena pasa a SerpAPI/Ignav. En Vercel el navegador sale de `@sparticuz/chromium` (wireframe, 67 MB Brotli en el bundle, se descomprime a `/tmp`), así que no hace falta instalarlo allí.

## Skills del proyecto (`.agents/skills`)

- `flight-deal-tracker` — memoria del proyecto: decisiones congeladas, arquitectura, fases. Leer antes de tocar código.
- `google-flights-scraper` — scraper Google Flights (TFS server-side, Playwright, structure-guard, fixtures).
- `supabase`, `supabase-postgres-best-practices`, `supabase-audit-rls` — Postgres/RLS.
- `vercel-react-best-practices`, `nextjs-app-router-patterns`, `nextjs-supabase-auth` — Next.js/Supabase.
- `browser-automation`, `playwright-explore-website`, `webapp-testing` — testing/E2E (requieren Playwright MCP).

Referencia (no usar como dependency): `data-scraper-agent` (padrón Python/GH Actions).

## Comandos (definidos en F1)

Todos se ejecutan en `app/` (working-dir).

- Lint: `npm run lint`
- Typecheck: `npm run typecheck` (`tsc --noEmit`)
- Tests: `npm test` (`vitest run`)
- Build: `npm run build`
- Supabase local: `supabase start` (requiere Docker), `supabase db reset`, `supabase stop`
- Migraciones: `supabase migration new <name>` → editar SQL → `supabase db reset`

Instalaciones de npm en este proyecto usan `--legacy-peer-deps` (conflictos por Node 20.15 vs peers de vitest/shadcn; CI usa Node 22 con `npm ci`).

## Estructura

- Raíz `E:\Scrapping`: `.agents/skills`, `docs/plans/FLIGHT-DEAL-TRACKER.md`, `AGENTS.md`, `opencode.json` (plugin + MCP Playwright), `.github/workflows/ci.yml`.
- `app/` — app Next.js (scaffold + auth). Alias `@/*` → `app/*`.
  - `app/actions/auth.ts` — Server Actions (signUp/signIn/signOut).
  - `app/login`, `app/signup`, `app/dashboard`, `app/page.tsx` — rutas.
  - `lib/supabase/{client,server,middleware}.ts`, `proxy.ts` — Supabase SSR (Next 16: proxy en vez de middleware).
  - `supabase/migrations/` + `supabase/seed.sql` — base de datos (esquema completo + RLS multi-tenant).
  - `components/ui/` — shadcn base-nova (Base UI: usa `render` prop, no `asChild`).
  - `lib/utils.test.ts`, `vitest.config.ts`, `vitest.setup.ts` — tests.
- Previsto: `src/domain/sources/` — `FlightSource` + `GoogleFlightsScraperSource` + `MockFlightSource` (F2).

## Reglas de trabajo

- Decisiones del plan congelado NO se cambian sin validación explícita del usuario.
- Tests sin dependencia de red: fixtures + `MockFlightSource`.
- Fail-closed en el scraper (nunca persistir datos corruptos).
- RLS multi-tenant desde el día 1.
- Probar con usuario seed: `demo@example.com` / `DemoPass123!` (creado por `supabase db reset`).