# Flight Deal Tracker — Plan ejecutable (congelado)

> Especificación ejecutable por fases. Cada fase define entregables, criterios de aceptación y verificación.
> Estado: PLAN CONGELADO. No cambiar decisiones sin validación explícita del usuario.

## 1. Resumen del producto

Webapp personal de monitorización de precios de vuelos. El usuario define búsquedas (origen-, destino, rango de fechas, opciones), el sistema consulta Google Flights (scraper propio vía Playwright) periódicamente, guarda histórico de precios, calcula tendencias y envía alertas por Telegram cuando aparecen buenos precios por debajo de un umbral configurado.

## 2. Decisiones clave (CONGELADAS)

| # | Área | Decisión |
|---|------|----------|
| D1 | Stack | Next.js (App Router) + TypeScript + React + Tailwind CSS + Supabase (PostgreSQL + Auth + Edge Fns) + Vercel |
| D2 | Backend | Sin backend separado. Route Handlers + Server Actions. Scheduler: tick interno en Postgres disparado por Vercel Cron |
| D3 | Fuentes | `GoogleFlightsScraperSource` (Playwright, PRINCIPAL) + `MockFlightSource` (dev/test). Fase 8: SerpAPI (fallback primario) y Kiwi/Tequila (2ª fuente). APIs externas NO obligatorias en MVP. **Sin Amadeus** |
| D4 | TFS | Construido server-side (URL determinista, sin interacción UI). `hl=es & gl=ES & curr=EUR` fijos en MVP (geografía configurable en el futuro) |
| D5 | Cookies | SOLO consentimiento anónimo (p. ej. `SOCS`). Prohibido login/cuentas/NID |
| D6 | Bloqueo | Fail-closed: degradar + skipear. No evasión de CAPTCHA/anti-bot. Endpoint `POST /admin/sources/retry` manual auditado con rate limit |
| D7 | Retención | Detalle de precios 3 meses (TTL). `price_stats_daily` agregados conservados indefinidamente para tendencias. Flag `retention.keep_aggregates=false` para purgar todo |
| D8 | Moneda | EUR por defecto, configurable por perfil. Conversión FX opcional vía Frankfurter (gratis) |
| D9 | Alertas | Provider pattern. Telegram primero (bot único). Comandos y suscripción por perfil |
| D10 | Concurrencia | Scheduler con leases (tick) en Postgres para evitar doble ejecución |
| D11 | Seguridad | RLS multi-tenant desde el día 1. Auth Supabase. Secretos en env |
| D12 | Alojamiento | Vercel (Hobby: cron 1/día), Supabase (Free: 500 MB, edge fn 150s/2s CPU) |

## 3. Arquitectura

### 3.1 Modelo de fuentes (interfaz `FlightSource`)

```ts
interface FlightSource {
  id: string;
  search(params: FlightSearchParams): Promise<FlightSourceResult>;
  health(): Promise<HealthStatus>;
}
```

Implementaciones:
- `GoogleFlightsScraperSource` — Playwright headless, PRINCIPAL.
- `MockFlightSource` — dev/test, determinista.
- SerpAPI / Kiwi — Fase 8 fallbacks.

### 3.2 Scraper Google Flights (componentizado)

- **URL builder**: TFS server-side determinista (`tfs=`, `hl=es`, `gl=ES`, `curr=EUR`).
- **Session/service**: Playwright, cookies consent-only, políticas de espera y timeouts.
- **Navigator**: rutas y pasos de navegación (separado del parser).
- **Parser**: extrae datos de la página (separado de la navegación).
- **Normalizer**: normaliza a esquema interno (separado).
- **Structure-guard**: detecta cambios de estructura y marca `source_structure_version` (fail-closed: degradar en vez de guardar datos corruptos).
- **Fixtures**: muestras reales `.html` para tests deterministas.
- **Cross-cutting**: rate limiting, retries con backoff, timeouts, logs estructurados, métricas, invalid-response detection.

### 3.3 Esquema de datos (Resumen)

- `profiles` — usuarios/perfiles.
- `searches` — búsquedas definidas (origen, destino, rangos, opciones).
- `search_executions` — ejecuciones programadas con estado, ratelimit y leases.
- `flight_options` / `flight_prices` — resultados y puntos de precio (TTL 3 meses).
- `price_stats_daily` — agregados diarios (indefinido).
- `alerts_edge` / `alert_dispatches` — thresholds y envíos Telegram.
- `source_structure_versions` — versionado de estructura.

## 4. Fases

### F1 — Foundation ✅
- Scaffold Next.js+TS+Tailwind, Supabase (Auth, DB), config env, CI (lint+typecheck+test).
- Migraciones base + seed + RLS.
- Skill a medida `google-flights-scraper` activa para fases de scraping.
- **Criterios de aceptación**: app arranca, auth funcional, migración aplicada, RLS verificado (audit), pipeline CI verde.
- **Verificado (2026-09-24)**: E2E UI (login demo, signup+profile, signout, ruta protegida → `/login?next=`), audit RLS 9/9 verde (`docs/audits/rls-audit-f1.md`), CI GitHub run #3 success (lint, typecheck, test, build) en Node 22.

### F2a — Search + Domain
- Modelo dominio (busquedas, ejecuciones), servicios, mock source.
- **Criterios**: CRUD searches, ejecución mock end-to-end, poll de estado.
- **Verificado (2026-09-24)**: dominio `MockFlightSource` (4 tests deterministas), CRUD searches por UI E2E (crear/editar/desactivar/eliminar), ejecución mock end-to-end persistida (`completed`, flight_options+flight_prices), poll client 600ms hasta terminal, `no_flights` → completed con mensaje, checks locales verdes (lint, typecheck, 6 tests, build), CI GitHub run OK.

### F2b — Google Flights Scraper
- Playwright MCP + `google-flights-scraper` skill. Fixtures: 10 rutas locales (ofertas, sin resultados, moneda, multi-ciudad, etc.).
- **Criterios**: buscador real `1 origen→NO-Destino`, fixtures pasan, structure-guard detecta rotura simulada, fail-closed verificado.
- **Verificado (2026-09-25)**: `buildTfsUrl` + `parsePage` (17/17 opciones en MAD→BCN, multi-leg OK), `structureGuard` estructural (markers título + ds:0 + ds:1 + payload JSON válido) — **semántica**: página válida con 0 opciones = resultado legítimo `no_flights` (NO es rotura); guard degrada solo con estructura rota o payload ds:1 corrupto/ausente (`missing_marker:*`, `parse_failed:ds1_missing_or_corrupt`). `GoogleFlightsScraperSource` con `HtmlFetcher` inyectable (tests offline, sin dep Playwright en runtime): fetch error → `fetch_failed` degradado, guard fail → `structure_mismatch` degradado, 0 opciones → `no_flights` no degradado. Fixtures reales: `mad-bcn-roundtrip.html` (17 opciones) y `aa-bcn-no-results.html` (AAA→BCN, sin resultados real) — capturados del DOM vivo vía MCP. 14 tests scraper deterministas + 25 suite total, lint/typecheck/build verdes.

### F3 — Results
- Guardado de resultados, listado/UI, detalle.
- **Criterios**: resultados persistentes y visibles, dedupe por (search, salida, regreso, tarifa).
- **Verificado (2026-09-25)**: persistencia ya heredada de F2a (`search_executions` + `flight_options` upsert dedupe por `search_id+dedupe_key` + `flight_prices` snapshot). Añadida página `/searches/[id]` (server component, RLS multi-tenant): lista opciones de la última ejecución terminada con precio actual, aerolíneas, duración y legs ida+regreso; botón "Ver resultados" por búsqueda en dashboard (solo si hay ejecución). E2E: crear búsqueda (MAD→BCN) → ejecutar con MockFlightSource → página muestra 3 opciones; 2ª ejecución mantiene 3 (dedupe); checks locales verdes (lint, typecheck, 25 tests, build).

### F4 — Historical
- Acumulación histórica, agregados diarios, tendencias.
- **Criterios**: stats_daily correctos, TTL limpia detalle, tendencias consultables.
- **Verificado (2026-09-25)**: migración `20260925120910_f4_historical.sql` — trigger `refresh_daily_stats` (AFTER INSERT en `flight_prices`) mantiene `price_stats_daily` (min/avg/max/obs por search+day, recomputado desde detalle) y `run_retention(age)` purga detalle >3 meses conservando agregados salvo `retention_keep_aggregates=false` (purgar todo). Seed demo: flag `true` (tabla ya la creaba el trigger `handle_new_user` → seed `on conflict do update`). UI `/searches/[id]` sección "Histórico de precios" (barra CSS min + min–max/media, sin librerías). Auditoría: `docs/audits/f4-historical-audit.md`. E2E UI con histórico de 2 días (95–110.50 y 60–95 EUR).

### F5 — Alerts
- Thresholds por búsqueda, engine de evaluación de buenos precios.
- **Criterios**: alerta se dispara y se registra dispatch, no duplica en ventana.
- **Verificado (2026-09-25)**: `src/domain/alerts/evaluate-alert.ts` (engine puro, 7 tests) + campo "Umbral de alerta (EUR)" en crear/editar búsqueda (`searches.alert_threshold_eur`). Tras cada ejecución completada se evalúa mejor precio vs umbral: si ≤ umbral y fuera de cooldown, materializa `alerts_edge` (telegram, 24h) y registra `alert_dispatches` (`dispatched`; envío real en F6). E2E: 60≤80 → dispatch + edge; 2ª ejecución en ventana → sin duplicado; umbral 50 → 60>50 sin disparo. Auditoría: `docs/audits/f5-alerts-audit.md`.

### F6 — Telegram (pospuesta al final)
- Bot único, comandos, suscripción, callback/estado.
- **Criterios**: suscripción ok, mensaje de alerta recibido, rate limit respetado.
- **Nota**: reordenada al FINAL del roadmap por decisión del usuario (2026-09-25). No se pierde diseño: F5 registra `alert_dispatches` (`dispatched`) y `alerts_edge` (provider `telegram`) como contrato de entrada; F7 ya expone el histórico de dispatchs en `/searches/[id]`. F6 solo añadirá el bot (webhook/getUpdates, comandos, chat_id por profile, `delivered`/`failed`).

### F7 — Scheduler
- Tick interno en Postgres (leases), Vercel Cron dispara.
- **Criterios**: sin doble ejecución, ejecuciones registradas, release de leases.
- **Verificado (2026-09-25)**: migración `20260925150000_f7_scheduler.sql` — `scheduler_tick()` (advisory lock global, selección de searches habilitados sin ejecución activa ni reciente, inserta `search_executions` con lease `tick:<txid>`, devuelve ejecuciones) + `release_expired_leases()` (leases zombie → `failed` tras gracia). Endpoint `POST /api/scheduler/tick` (auth Bearer `CRON_SECRET`, cliente service_role, fire-and-forget) + `vercel.json` cron `0 6 * * *`. Refactor: ejecución compartida en `src/domain/search/execute-search.ts` (usa el endpoint manual y el cron; limpia leases al marcar estado). E2E: tick → ejecución `completed` con 3 precios → alerta disparada (60≤80), UI sección **Alertas** en `/searches/[id]` (F6-prep, historial de dispatches). Auditoría: `docs/audits/f7-scheduler-audit.md`. Suite 32/32, lint/typecheck/build verdes.

### F8 — Fallback API
- SerpAPI primario (free 250/mes, 50/h), Kiwi/Tequila secundario.
- **Criterios**: switch failover automático, cooldown y medidas respetadas.
- **Verificado (2026-09-26)**: Kiwi/Tequila **eliminado** del plan (cerró el acceso público en mayo 2024; nuevas integraciones solo por canal B2B a invitación). Sustituido por **Ignav** (decisión del usuario). Cadena de failover en `src/domain/sources/chain.ts` (`FLIGHT_SOURCES` = orden de failover; gana la primera no degradada; `no_flights` legítimo **no** hace failover; `mock` se descarta si hay una fuente real para no persistir precios fabricados). `SerpApiFlightSource` (engine `google_flights`) + `IgnavFlightSource` (`/api/fares/round-trip|one-way`, trae `inbound` en la misma llamada) con fetcher JSON inyectable + fixtures. **Dos bugs previos corregidos**: `execute-search.ts` ignoraba `result.degraded` (un `fetch_failed` se guardaba como `completed`) y `parse-page.ts` generaba `dedupe_key` con índice posicional (fragmentaba el histórico de precios) → ahora `optionKey()` derivada de segmentos. Sin migración: el enum ya incluía `degraded`. Suite 81/81 (16 serpapi, 16 ignav, 12 chain, 4 integración del runner), lint/typecheck/build verdes. Auditoría: `docs/audits/f8-fallback-api-audit.md`. Pendiente: flexible-dates de Ignav, regreso de SerpAPI/Google (2º request), `POST /admin/sources/retry` → F10.

### F9 — Flexible search
- Multidestino, rangos flexibles, moneda/geografía por perfil, tendencias globales.
- **Criterios**: flujos nuevos usan misma interfaz de fuente y retención.
- **Verificado (2026-09-26)**: alcance acotado por el usuario a moneda + tendencias +
  rangos flexibles (multidestino y geografía fuera). Migración
  `20260925200000_f9_flexible_search.sql` (`searches.date_flex_days` 0–21);
  `FlightSearchParams.flexDays` viaja por la misma interfaz de fuente —
  `MockFlightSource` devuelve una opción por día de la ventana `-n..+n` (determinista,
  dedupe por fecha real); `updateProfileCurrency` valida IATA de 3 letras sobre
  `profiles.currency`; dashboard con "Preferencias" (moneda) y "Tendencias (últimos 7
  días)" sobre `price_stats_daily` (sin schema nuevo); `PriceHistory`/`AlertHistory`
  etiquetan con la moneda del perfil. Seed: 2ª búsqueda `MAD → LHR` con flex 5.
  E2E: EUR→USD→EUR, 11 opciones en ventana flex 5, 5 en flex 2, 2 en flex 0.
  Unit 33/33, typecheck, lint, build verdes. Auditoría:
  `docs/audits/f9-flexible-search-audit.md`. Pendiente para F9 completo: multidestino
  y geografía; FX sigue siendo opcional (D8).

### F10 — Optimization
- Métricas, caché, batch, costes. Revisión retención y límites Vercel/Supabase.
- **Criterios**: tiempos y costes medidos, sin regresiones en F1–F9.

## 5. Riesgos (documentados 2026)

- **Legal**: ToS de Google prohíben queries automatizadas; precedentes hiQ v. LinkedIn / Meta v. Bright Data; derecho sui generis UE; GDPR. Uso personal y de bajo volumen; sin evasión de CAPTCHA/anti-bot.
- **Técnico**: BotGuard firma RPCs con token `X-Goog-BatchExecute-Bgr` (desde ~ago/2026) → exige navegador real (Playwright), no request simple. Cambios de estructura → structure-guard fail-closed.
- **Límites**: Vercel Hobby (cron 1/día, timeout 300 s, 1M invocaciones/mes); Supabase Free (500 MB, pausa 7 días, edge fn 150s/2s CPU); Telegram ~30 msg/s (1/s por chat, 20/min/grupo); SerpAPI free 250/mes 50/h.
- **Mitigación general**: fail-closed + `POST /admin/sources/retry` auditado con rate limit; fixtures; observabilidad.

## 6. Entregables transversales

- `AGENTS.md` con comandos (lint/typecheck/tests) y estructura.
- Skills a medida: `google-flights-scraper`, `flight-deal-tracker`.
- Docs por fase (adr/decision-log en este archivo o `docs/adr/`).