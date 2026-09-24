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

### F3 — Results
- Guardado de resultados, listado/UI, detalle.
- **Criterios**: resultados persistentes y visibles, dedupe por (search, salida, regreso, tarifa).

### F4 — Historical
- Acumulación histórica, agregados diarios, tendencias.
- **Criterios**: stats_daily correctos, TTL limpia detalle, tendencias consultables.

### F5 — Alerts
- Thresholds por búsqueda, engine de evaluación de buenos precios.
- **Criterios**: alerta se dispara y se registra dispatch, no duplica en ventana.

### F6 — Telegram
- Bot único, comandos, suscripción, callback/estado.
- **Criterios**: suscripción ok, mensaje de alerta recibido, rate limit respetado.

### F7 — Scheduler
- Tick interno en Postgres (leases), Vercel Cron dispara.
- **Criterios**: sin doble ejecución, ejecuciones registradas, release de leases.

### F8 — Fallback API
- SerpAPI primario (free 250/mes, 50/h), Kiwi/Tequila secundario.
- **Criterios**: switch failover automático, cooldown y medidas respetadas.

### F9 — Flexible search
- Multidestino, rangos flexibles, moneda/geografía por perfil, tendencias globales.
- **Criterios**: flujos nuevos usan misma interfaz de fuente y retención.

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