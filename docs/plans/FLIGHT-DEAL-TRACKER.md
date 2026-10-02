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

### F2c — Wiring real del scraper (Playwright) + tramo de regreso
- `playwright-core` (navegador externo, `CHROMIUM_PATH` en self-hosted), contexto anónimo por búsqueda, cookie `SOCS` + botón "Aceptar todo" si aparece el muro de consentimiento, `headless`.
- **Criterios**: `FLIGHT_SOURCES=google_flights` produce opciones reales end-to-end; ida y vuelta con legs de regreso; suite offline verde; fail-closed intacto.
- **Verificado (2026-09-28)**: `playwright-fetcher.ts` (navegación + click-through) cableado en `chain.ts` (sin llave; si el navegador no arranca, la fuente degrada y la cadena pasa a SerpAPI/Ignav). El regreso **no** está en el HTML del servidor: se renderiza desde el RPC `POST /_/FlightsFrontendUi/.../GetShoppingResults` tras hacer click en la primera tarjeta (`element.click()`: la tarjeta `div[role="link"]` intercepta el puntero). `rpc-return-legs.ts` parsea el frame stream (`)]}'` + líneas `<len>` + JSON) → regresos en `data[3][0]` y el outbound seleccionado con búsqueda recursiva en `data[1]`. `attachReturnLegs()` añade el vuelo elegido + el regreso más barato (el precio del RPC es el total ida/vuelta) como opción con `inboundLegs`; si el vuelo elegido ya estaba en la lista se **sustituye en sitio** (mismo `id`, sin bifurcar el histórico). Nunca degrada: one-way, `flexDays > 0` o regreso ilegible → opciones de ida con `inboundLegs: []` y precio total. `parseOptionsPayload` lee **los dos** bloques de `ds:1`: `data[2][0]` ("mejores opciones", 3) y `data[3][0]` (lista completa), en ese orden y sin repetir vuelos — leer solo el segundo descartaba los 3 más baratos, incluido el que Google marca como mejor. Fixtures del mismo run: `mad-bcn-clickthrough.html` (17 opciones) + `mad-bcn-return-legs.txt` (3 regresos, UX 7706/7708/6007+6030). **Tres fallos reales encontrados en vivo y arreglados**: (1) la página de ida dispara su propio `GetShoppingResults` y la carrera lo capturaba → se ignoran requests previos al click y se toma el primer cuerpo que *parsea*; (2) el shell se sirve a veces sin `ds:1` (1 de cada 3) → un reload en el fetcher antes de degradar; (3) el handler de la tarjeta no siempre está bound al primer click → re-click idempotente con deadline de 45 s. Smoke live 3/3 con 19 opciones y la más barata ya con ida+regreso (113 EUR UX 1013 + 675+682); 88 tests, lint/typecheck/build verdes.
- **Pendiente**: ninguno. El Chromium en Vercel Hobby que quedaba abierto aquí quedó resuelto en F10 (slice 2) con el wireframe `@sparticuz/chromium`, verificado en producción el 2026-10-01.

### F3 — Results UI
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

### F6 — Telegram (pospuesta post-MVP)
- Bot único, comandos, suscripción, callback/estado.
- **Criterios**: suscripción ok, mensaje de alerta recibido, rate limit respetado.
- **Nota**: reordenada al FINAL del roadmap por decisión del usuario (2026-09-25) y **pospuesta post-MVP el 2026-10-02**. No se pierde diseño: F5 registra `alert_dispatches` (`dispatched`) y `alerts_edge` (provider `telegram`) como contrato de entrada; F7 ya expone el histórico de dispatchs en `/searches/[id]`. F6 solo añadirá el bot (webhook/getUpdates, comandos, chat_id por profile, `delivered`/`failed`).

### F7 — Scheduler
- Tick interno en Postgres (leases), Vercel Cron dispara.
- **Criterios**: sin doble ejecución, ejecuciones registradas, release de leases.
- **Verificado (2026-09-25)**: migración `20260925150000_f7_scheduler.sql` — `scheduler_tick()` (advisory lock global, selección de searches habilitados sin ejecución activa ni reciente, inserta `search_executions` con lease `tick:<txid>`, devuelve ejecuciones) + `release_expired_leases()` (leases zombie → `failed` tras gracia). Endpoint `POST /api/scheduler/tick` (auth Bearer `CRON_SECRET`, cliente service_role, fire-and-forget) + `vercel.json` cron `0 6 * * *`. Refactor: ejecución compartida en `src/domain/search/execute-search.ts` (usa el endpoint manual y el cron; limpia leases al marcar estado). E2E: tick → ejecución `completed` con 3 precios → alerta disparada (60≤80), UI sección **Alertas** en `/searches/[id]` (F6-prep, historial de dispatches). Auditoría: `docs/audits/f7-scheduler-audit.md`. Suite 32/32, lint/typecheck/build verdes.

### F8 — Fallback API
- SerpAPI primario (free 250/mes, 50/h), Kiwi/Tequila secundario.
- **Criterios**: switch failover automático, cooldown y medidas respetadas.
- **Verificado (2026-09-26)**: Kiwi/Tequila **eliminado** del plan (cerró el acceso público en mayo 2024; nuevas integraciones solo por canal B2B a invitación). Sustituido por **Ignav** (decisión del usuario). Cadena de failover en `src/domain/sources/chain.ts` (`FLIGHT_SOURCES` = orden de failover; gana la primera no degradada; `no_flights` legítimo **no** hace failover; `mock` se descarta si hay una fuente real para no persistir precios fabricados). `SerpApiFlightSource` (engine `google_flights`) + `IgnavFlightSource` (`/api/fares/round-trip|one-way`, trae `inbound` en la misma llamada) con fetcher JSON inyectable + fixtures. **Dos bugs previos corregidos**: `execute-search.ts` ignoraba `result.degraded` (un `fetch_failed` se guardaba como `completed`) y `parse-page.ts` generaba `dedupe_key` con índice posicional (fragmentaba el histórico de precios) → ahora `optionKey()` derivada de segmentos. Sin migración: el enum ya incluía `degraded`. Suite 81/81 (16 serpapi, 16 ignav, 12 chain, 4 integración del runner), lint/typecheck/build verdes. Auditoría: `docs/audits/f8-fallback-api-audit.md`. Pendiente: flexible-dates de Ignav (F9 sólo lo.extiende por `MockFlightSource`) y el regreso de SerpAPI (2º request) — el de Google se cerró en F2c —. `POST /admin/sources/retry` quedó cerrado en F10 (slice 3).

### F9 — Flexible search
- Rangos flexibles, moneda por perfil, tendencias globales. Multidestino y geografía por perfil quedan fuera de alcance (decisión del usuario, 2026-09-26).
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
  `docs/audits/f9-flexible-search-audit.md`. FX sigue siendo opcional (D8) y
  multidestino/geografía quedan fuera de alcance salvo decisión nueva del usuario.

### F10 — Optimization
- Métricas, caché, batch, costes. Revisión retención y límites Vercel/Supabase.
- **Criterios**: tiempos y costes medidos, sin regresiones en F1–F9.
- **Verificado (2026-09-28, slice 1)**: **bug real de F7 corregido** — `/api/scheduler/tick` lanzaba las ejecuciones con `void` (fire-and-forget) y Vercel congela la invocación al responder, así que en producción el cron no ejecutaba nada; ahora se esperan **secuencialmente** dentro de un presupuesto de 45 s (el resto queda `deferred` y lo recoge el siguiente tick cuando expira el lease de 10 min; la respuesta incluye `completed`/`deferred`/`ms`). **Métricas de tiempo sin tablas nuevas**: `searchWithFailover` mide `ms` por intento (queda en `attempts`) y `runExecution` guarda `durationMs` en `raw_result` de `search_executions` (rutas `completed`, `degraded` y `failed`), suficiente para comparar coste por fuente. Coste medido del scraper: ~10 s por ruta (2 cargas de página + click-through), muy por encima de los ~0,5 s de SerpAPI/Ignav. 88 tests, lint/typecheck/build verdes.
- **Slice 2 — Chromium en Vercel**: `playwright-fetcher.ts` resuelve el navegador con `browserPlan(env)`: `CHROMIUM_PATH` > `VERCEL` → wireframe `@sparticuz/chromium` (el bundle completo no entra; 250 MB descomprimido) > `playwright-core` propio. El wireframe empaqueta el navegador como `chromium.br` (67 MB Brotli) y lo descomprime a `/tmp` en cold start (`executablePath()`, verificado localmente: 209 MB, sin red). `next.config.ts` declara `outputFileTracingIncludes` para que los `.br` viajen en el trace: la ruta del tick **traza 80 MB de 232 ficheros**, muy por debajo del límite. Añadido `playwright-fetcher.test.ts` (3 asserts sobre `browserPlan`). Límite conocido: sparticuz fuerza `--single-process` y solo trae `chrome-headless-shell` (no el build parcheado de Playwright); si Playwright 1.63 no lo lleva, la fuente degrada y la cadena cae a SerpAPI/Ignav, sin pérdida de datos.
- **Slice 3 — retención + reintento auditado (D6)** (2026-09-29): **`run_retention()` (F4) no tenía ningún caller** — nada purgaba `flight_prices` en todo el proyecto; ahora el tick la ejecuta con `service_role` (la función es `security definer` sin `revoke` → sin migración) **antes** de `scheduler_tick()` y del loop de scraping, también en los ticks sin nada que raspar, y expone `pricesPurged` en la respuesta. **`POST /api/admin/sources/retry` (D6)**: `Bearer <CRON_SECRET>`, body `{ searchId }`, service_role, scrape esperado (`maxDuration = 60`, nunca `void`) y **auditoría sin tabla nueva** — cada intento es otra fila de `search_executions` y `runExecution` acepta un 5º param `context` que se mezcla en los 4 `raw_result` (`actor: "admin"`, `retriedFrom: <id>`). Guard puro `src/domain/search/retry-guard.ts` (5 tests) → 429 con motivo: `execution_in_flight`, `last_execution_completed`, `cooldown` (15 min, **solo** si la última fue ya un retry admin, para poder reintentar al instante tras un `degraded` del cron). `runSearchById` extraído de `tick/route.ts` a `execute-search.ts` y compartido por cron y retry. E2E local: purga real (`pricesPurged: 1`, 0 filas viejas) y las 7 rutas del endpoint (401/400/400/404/429 completed/429 cooldown/200). 96 tests, typecheck/lint/build verdes. Auditoría: `docs/audits/f10-optimization-audit.md`.
- **Verificado en producción (2026-10-01)**: desplegado en Vercel (`flight-deal`, scope `pablo-cdfb`) contra el Supabase **hospedado** (`extpuygtrjvqzkmouqef`), migraciones y seed aplicados, tick y retry auditado ejecutados de verdad. **Cinco bugs que sólo aparecen en producción, todos por el mismo motivo raíz: el tope de 60 s de la invocación y nada acotado a él.** (1) `playwright-core` se excluía del bundle (`browsers.json` no encontrado) → `serverExternalPackages` + trace; (2) `mark()` borraba el lease en la marca `running` inicial, así que una ejecución muerta a mitad quedaba `running` **para siempre** bloqueando su search; (3) el reaper sólo miraba `lease_expires_at` y un retry manual inserta sin lease → ahora recupera también por edad (`20261001210000_f10_lease_reaper_by_age.sql`) y el endpoint de retry lo llama antes de `canRetry`; (4) sin presupuesto por búsqueda: el deadline lo calcula `GoogleFlightsScraperSource.search()` y lo reciben los dos fetchers (una búsqueda = **dos** cargas, resultados + regreso), `stepTimeout()` acota cada espera y lanza `budget_exhausted:<paso>`; el chain tampoco pregunta a otra fuente si se agotó; (5) la caché de navegador a nivel de módulo sobrevivía a una lambda caliente con Chromium ya muerto → `getBrowser()` valida `isConnected()`. Además `httpJsonFetcher` gana `AbortSignal.timeout(10_000)`: una API colgada se comía la invocación. **Tiempos reales**: launch 3.167 ms, HTML 4.017 ms, MAD→BCN completo 9.830 ms, MAD→LHR 6.221 ms, tick con 2 búsquedas 19.194 ms, SerpAPI 2.390 ms, Ignav 5.090 ms. En local la misma búsqueda tarda 9.015 ms y parsear 2.4 MB son 11 ms → el coste no es CPU ni Google, es el margen del plataforma. `FLIGHT_SOURCES=google_flights,serpapi,ignav` con ambas claves verificadas (SerpAPI 17 opciones 112–463 EUR, Ignav 235 opciones 126–531 EUR). 102 tests, lint/typecheck verdes. Auditoría: `docs/audits/f10-optimization-audit.md`.
- **Usándolo de verdad (2026-10-02)**: desactivada la Deployment Protection (la app ya responde público; login y dashboard verificados con el usuario demo). Dos bugs más, ambos sólo visibles al usarlo. (6) `runExecution` insertaba una fila de `flight_prices` por cada opción **que tiene el search**, no por cada opción **observada** en la corrida: las no revisitadas caían en `price_eur: 0` por el `?? 0` y la tarjeta de Tendencias mostraba `desde 0.00 EUR` (con 60–240 EUR reales en la BD); ahora sólo se registra el precio observado y en la BD hospedada se borraron las 5 filas con 0 y se recalcularon `price_stats_daily`. (7) El botón **Ejecutar** del dashboard, en la primera invocación tras un deploy, dejaba su ejecución en `running` toda la invocación: Playwright sólo acota las llamadas que aceptan `timeout` (`goto`, `waitFor`, `waitForResponse`) y el resto esperaba sin techo (unpack del wireframe de 67 MB, `launch`, `newContext`, `content`, `response.text`, el click del regreso) → `withBudget()` les pone el deadline de la búsqueda y el teardown del contexto lleva 5 s propios. El reaper recuperó la ejecución muerta (`released: 1`). **Cold start medido: ~25-30 s** (descomprimir el wireframe): en frío la fuente completa pero pierde el tramo de regreso (enriquecimiento, nunca puerta) y la cadena sigue; en caliente ~9-10 s con regreso. 106 tests, lint/typecheck/build verdes. Deploy verificado: `flight-deal-gqyf9x4rg`.
- **Pendiente**: el cron real `0 6 * * *` aún no ha disparado (los smokes han sido manuales) y el cold start matinal se comerá el tramo de regreso de la primera búsqueda del día. Con ~10 s por búsqueda y 45 s de presupuesto el tick cubre ~2 búsquedas por día en Hobby; `p_batch_size` sobra, manda el reparto por presupuesto. Si el volumen de searches crece, el siguiente escalón es self-hosted/VPS (sin tope de 60 s) antes que añadir caché.

## 5. Pendientes actuales (2026-10-02)

Foto del estado tras el rediseño visual/UX. **Ninguna fase del MVP está a medias**: lo que sigue son huecos conocidos, no trabajo sin terminar.

- **F6 (Telegram)** — única fase sin arrancar, pospuesta post-MVP por decisión del usuario (2026-10-02). Contrato de entrada ya cerrado (F5 + F7). No hay ruta `/alerts`: no se añade sin decidir.
- **Primer cron real** — `0 6 * * *` nunca ha disparado; todo lo verificado fue a mano. El cold start (~25-30 s) hará que la primera búsqueda del día salga sin tramo de regreso (enriquecimiento, no puerta). Comprobar el 2026-10-03 y ajustar si el reparto por presupuesto de 45 s no cubre las búsquedas activas.
- **Fuentes secundarias** — flexible-dates de Ignav y el regreso de SerpAPI (2º request). El de Google ya está cerrado desde F2c.
- **Multidestino / geografía por perfil** — fuera de alcance por decisión del usuario; sólo se abren con petición explícita.
- **Rediseño visual/UX** — dos pasadas (`95c5a68`, `d1194ef`) más la pantalla de resultados, filtros por URL, estados honestos y `/settings` (`326fbe2`). Un deal por búsqueda en el radar, `airlineName` desde `leg[22][3]`, filtros por `GET` en servidor (`src/domain/deals/filters.ts`), estado `failed` con el `error_message` real y aviso de precios >24 h. 111 tests, lint/typecheck/build verdes; verificado a 1440 px y 375 px, sin errores de consola.
- **Desplegado (2026-10-02)** — `flight-deal-iqnew90zt` (alias `flight-deal-alpha.vercel.app`), desde la raíz del repo. Verificado en producción con el usuario demo: login, dashboard, `/settings`, resultados con los 12→11 filtros por `dur=100&ord=duration`, y una **ejecución real** (botón Ejecutar) que trajo `airlineName` ya poblado en vivo — el dropdown de aerolínea muestra Air Europa / Iberia / Vueling y el mejor precio queda en 89 EUR. `airlineName` era el único cambio sin probar fuera de fixtures.
- **Datos locales** — la BD de desarrollo conserva 6 filas de `flight_prices` con `0` del 2026-09-29 (la hospedada está limpia desde F10). Se va con `supabase db reset`.

## 6. Riesgos (documentados 2026)

- **Legal**: ToS de Google prohíben queries automatizadas; precedentes hiQ v. LinkedIn / Meta v. Bright Data; derecho sui generis UE; GDPR. Uso personal y de bajo volumen; sin evasión de CAPTCHA/anti-bot.
- **Técnico**: BotGuard firma RPCs con token `X-Goog-BatchExecute-Bgr` (desde ~ago/2026) → exige navegador real (Playwright), no request simple. Cambios de estructura → structure-guard fail-closed.
- **Límites**: Vercel Hobby (cron 1/día, timeout 300 s, 1M invocaciones/mes); Supabase Free (500 MB, pausa 7 días, edge fn 150s/2s CPU); Telegram ~30 msg/s (1/s por chat, 20/min/grupo); SerpAPI free 250/mes 50/h.
- **Mitigación general**: fail-closed + `POST /admin/sources/retry` auditado con rate limit; fixtures; observabilidad.

## 7. Entregables transversales

- `AGENTS.md` con comandos (lint/typecheck/tests) y estructura.
- Skills a medida: `google-flights-scraper`, `flight-deal-tracker`.
- Docs por fase (adr/decision-log en este archivo o `docs/adr/`).