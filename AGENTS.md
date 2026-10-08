# AGENTS.md

## Stack

Next.js (App Router, **v16 — ver breaking changes en `node_modules/next/dist/docs/`**) + TypeScript + React 19 + Tailwind CSS v4 + shadcn (`base-nova`/Base UI) + Supabase (PostgreSQL/Auth) + Vercel.

## Fase actual

Plan congelado en `docs/plans/FLIGHT-DEAL-TRACKER.md`. **MVP cerrado y verificado en producción: F1–F5, F7, F8, F9, F2c y F10 ✅** (F2c el 2026-09-28: wiring real del scraper Google con `playwright-core` + click-through del tramo de regreso vía RPC `GetShoppingResults`; Chromium se instala aparte y en self-hosted se apunta con `CHROMIUM_PATH`. F10 verificado en deploy real el 2026-10-02, con 7 bugs corregidos: ver plan y `docs/audits/f10-optimization-audit.md`). **F6 (Telegram) pospuesta post-MVP por decisión del usuario (2026-10-02): no arrancarla sin que lo pida.** En curso (2026-10-08): **F11 agregación tarjeta-por-fuente** (`searchWithSequentialMerge`, `flight_options.source_id`, badge en UI, sin fusión) + **fase booking híbrida** (SerpAPI barata por POST + Ignav top-3 por GET, `flight_options.booking_links`, genérico siempre visible). Docker engine OK (VHDX en `E:\DockerDesktop\wsl`).

Producción: Vercel `flight-deal` (scope `pablo-cdfb`, Root Directory `app`) contra Supabase hospedado `extpuygtrjvqzkmouqef`. **Desplegar desde la raíz del repo** (`E:\Scrapping`), nunca desde `app/`: el Root Directory se aplicaría dos veces y falla con `No Next.js version detected`. Cadenas de `vercel curl` usan `$env:VERCEL_TOKEN` (con `--token` el valor se reenvía al curl y falla).

Chromium (`npx playwright install chromium`, cache en `%LOCALAPPDATA%\ms-playwright`) es requisito para `FLIGHT_SOURCES=google_flights`; sin navegador la fuente degrada y la cadena pasa a SerpAPI/Ignav. En Vercel el navegador sale de `@sparticuz/chromium` (wireframe, 67 MB Brotli en el bundle, se descomprime a `/tmp`), así que no hace falta instalarlo allí.

**El tope de 60 s de la invocación de Vercel (`maxDuration`) es la restricción que manda en el diseño del scraper.** Nada dentro puede esperar sin techo: el presupuesto por búsqueda (`SCRAPE_BUDGET_MS`, 30 s) lo calcula `GoogleFlightsScraperSource.search()` y lo reciben `HtmlFetcher`/`ReturnLegsFetcher` (una búsqueda son **dos** cargas: resultados + regreso), `stepTimeout()`/`withBudget()` acotan cada espera —incluidas las llamadas de Playwright sin `timeout` (unpack del wireframe, `launch`, `newContext`, `content`)— y lanzan `budget_exhausted:<paso>`, el chain no pregunta a otra fuente si se agotó, y las fuentes HTTP llevan `AbortSignal.timeout(10_000)`. Una ejecución muerta a mitad bloquea su search para siempre, así que el lease se conserva mientras corre y `release_expired_leases()` recupera por lease **y por edad** (el retry manual inserta sin lease).

El **cold start cuesta ~25-30 s** (descomprimir el wireframe de Chromium): en frío la fuente completa pero pierde el tramo de regreso (es enriquecimiento, nunca puerta) y la cadena sigue. Como el cron de las 06:00 arranca en frío, la primera búsqueda del día irá sin regreso. Sólo se escriben en `flight_prices` los precios **observados** en la corrida: rellenar con 0 las opciones no revisitadas metía observaciones fabricadas y arrastraba el mínimo diario a 0 (era el bug de la tarjeta de Tendencias).

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

Local y CI en **Node 22** (local 22.23.2 desde 2026-10-03; CI `node-version: 22`). `npm ci` funciona sin flags: `--legacy-peer-deps` ya no hace falta (el conflicto de peers venía de Node 20.15).

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