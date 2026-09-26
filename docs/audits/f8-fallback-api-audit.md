# Auditoría F8 — Fallback API (2026-09-26)

Cadena de failover multi-fuente alrededor de la interfaz `FlightSource` ya existente.
Sin migración de schema, sin dependencia nueva, sin red en los tests.

## Cambio de plan (decisión del usuario)

- **Kiwi/Tequila eliminado.** Cerró el acceso público en mayo 2024; las nuevas
  integraciones solo entran por canal B2B a invitación. Verificado contra su web, no
  queda documentación self-serve.
- **Ignav lo sustituye** como segundo proveedor. 1.000 requests gratis y después
  $2/1.000, self-serve inmediato, y **devuelve el tramo de vuelta en la misma
  respuesta** (`inbound` junto a `outbound`), que es justo lo que Google y SerpAPI
  esconden tras un click.
- `POST /admin/sources/retry` (D6) **aplazado a F10**. F8 no lo incluye.

## Cambios

### Bugs previos corregidos (bloqueaban F8)

1. `execute-search.ts` **nunca leía `result.degraded`**. Un `fetch_failed` con
   `options: []` caía en la rama de "sin vuelos" y se guardaba como `completed` con
   `structure_check_passed: true`: una violación de fail-closed que, además, hacía
   imposible el failover (no había forma de saber que la fuente había fallado).
   Ahora `degraded` se comprueba **antes** de contar opciones → ejecución `degraded`,
   `structure_check_passed: false`, sin persistir y sin evaluar alertas. El enum de
   `search_executions.status` ya incluía `'degraded'`, por eso no hay migración.
2. `parse-page.ts` generaba el `dedupe_key` con **índice posicional**
   (`gf-<airline>-<flightNumber>-<i>`). Si el proveedor reordenaba resultados o
   cambiaba el número de opciones, la clave cambiaba y el histórico de precios se
   fragmentaba en filas nuevas. Ahora el key sale de `optionKey()`, derivada de los
   segmentos. `MockFlightSource` ya usaba clave por contenido y no se tocó.

### Nuevo

- `src/domain/sources/option-key.ts` — `optionKey(sourceId, outbound, inbound)`.
  Raíz común para las tres fuentes reales; el prefijo de fuente evita colisiones.
- `src/domain/sources/http-json.ts` — transporte JSON inyectable (GET/POST +
  status HTTP) y `parseJson` tolerante. El status se devuelve a propósito: hay que
  distinguir cuota/auth/billing de un payload real para degradar en vez de parsear
  un cuerpo de error como "no hay vuelos".
- `src/domain/sources/serpapi-source.ts` — engine `google_flights`.
- `src/domain/sources/ignav-source.ts` — `POST /api/fares/round-trip|one-way`.
- `src/domain/sources/chain.ts` — `resolveChain(env)` + `searchWithFailover()`.
- Fixtures `serpapi-mad-bcn.json` e `ignav-mad-bcn.json`.
- `src/domain/search/execute-search.ts` — usa la cadena en lugar de `new MockFlightSource()`.
- `.env.example` / `.env` — `FLIGHT_SOURCES`, `SERPAPI_API_KEY`, `IGNAV_API_KEY`.

## Semántica de la cadena

- `FLIGHT_SOURCES` es una lista separada por comas y **su orden es el de failover**.
  Default `mock`.
- **Guarda de seguridad:** si la lista contiene una fuente real, `mock` se descarta.
  Un fallback sintético persistiría precios fabricados junto a los reales y
  envenenaría el histórico en silencio.
- Gana la primera fuente **no degradada**. Un `options: []` con `degraded: false` es
  `no_flights` legítimo y **detiene** la cadena: seguir buscando daría un precio
  falso de otra fuente para una ruta que simplemente no tiene vuelos.
- Una fuente que **lanza excepción** se trata como degradada en vez de abortar la
  cadena entera.
- Todas degradadas (o cadena vacía) → `degraded`, `error_message` con la causa, y
  `raw_result` con `sourceId`, `attempts` y `skipped` para poder diagnosticar.
- Fuente listada sin key → se salta con `skipped`, no rompe la ejecución.

## Mapeo de parámetros (SerpAPI)

Dos codificaciones se invierten fácilmente y devuelven silenciosamente otra cosa,
así que están pineadas en el código con comentario:

- `type`: **1 = round trip**, 2 = one way, 3 = multi-city.
- `stops`: **0 = cualquiera**, 1 = solo directo, 2 = máx. 1 escala, 3 = máx. 2.

Deliberadamente **no** se envía `gl`/`hl` (D4 los congela en MVP para el scraper
directo) ni `multi_city_json`.

## Verificación

- Unit 81/81 (antes 33): `serpapi-source` (16), `ignav-source` (16), `chain` (12),
  `execute-search` (4, integración con la cadena).
  - Runner: cadena vacía → `degraded` sin persistir nada; `skipped` queda en
    `raw_result`; cadena `mock` → `completed` con 3 opciones; y las `dedupe_key` son
    idénticas entre dos ejecuciones seguidas (prueba directa del fix nº 2).
  - Cadena: orden, failover tras degradación, `no_flights` **no** hace failover,
    todas degradadas, cadena vacía, excepción no aborta, `mock` descartado, key
    ausente saltada, nombre desconocido saltado, lista con espacios/MAYÚSCULAS.
  - SerpAPI: mapeo de `best_flights`+`other_flights`, tiempos a ISO local, ids
    estables al reordenar, `type`/`stops`/`travel_class`/`return_date`, one-way sin
    `return_date`, 429/401 degradan, error con status 200 degrada, `Processing`
    degrada, JSON malformado degrada, resultados no parseables degradan
    (`no_options_parsed`), vacío = `no_flights`, `flexDays` degrada sin gastar
    request.
  - Ignav: itinerarios, `inbound` mapeado, suma de duraciones, moneda tomada de la
    respuesta, POST + `X-Api-Key` + cuerpo, ruta one-way, `max_stops` condicional,
    401/402/424/429 degradan, error documentado degrada, sin itinerarios =
    `no_flights`, `flexDays` degrada.
- `typecheck`, `lint`, `build` verdes.

## Notas / ceilings

- **Los fixtures vienen de los ejemplos de respuesta oficiales de cada proveedor**,
  no de una llamada en vivo: no hay keys en local. Cuando haya keys, reemplazarlos
  por capturas reales es el paso natural.
- La base de SerpAPI es `https://serpapi.com/search` (la que muestra su doc), **no**
  la versionada `v13` que tenía anotada en el plan: sin key no había forma de
  verificar que `v13` respondiera, y el ejemplo documentado sí. Si algún día
  `v13` se usa, es un cambio de una línea.
- **No hay contador de presupuesto propio.** SerpAPI Free son 250/mes y 50/h, y solo
  cuenta búsquedas exitosas; con el cron 1/día el uso real ronda 90-180/mes. Un
  429/402 degrada y la cadena salta a la siguiente fuente. Una tabla de cuota en
  Postgres sería infraestructura especulativa: el propio proveedor hace cumplir la
  suya. `ponytail: rely on provider-side quota, add a local budget table if
  per-provider budgets or spend caps become a requirement`.
- **flexDays**: las fuentes de API devuelven `degraded: flex_unsupported` en vez de
  buscar solo las fechas exactas. Es fail-closed a propósito — buscar en silencio
  solo las fechas exactas mentiría sobre lo que el usuario pidió. El upgrade es
  barato: `POST /api/fares/search` de Ignav acepta un rango de fechas en una llamada.
  **Pendiente de decisión.**
- **Regreso de SerpAPI**: `inboundLegs` va vacío; el precio sí es el total ida+vuelta,
  pero los tramos de vuelta exigen un **segundo request** con el `departure_token` de
  cada resultado. Es el mismo trabajo que el click-through de Google, así que se
  resolverá una sola vez para ambos en la fase de wiring.
- Ignav **no tiene parámetro de moneda** (solo `market`, que es país). La moneda se
  toma de `price.currency` de la respuesta, que puede no coincidir con la del perfil
  (D8, sin conversión FX). `flight_options` ya guarda la moneda por fila desde F9.
- `IgnavFlightSource.health()` consulta `/api/health` (gratuito).
  `SerpApiFlightSource.health()` es solo estructural: validar la key requiere gastar
  cuota, así que la cadena detecta la key muerta vía `search()`.
- `google` **no** está registrado en `resolveChain`: `GoogleFlightsScraperSource`
  existe pero no tiene fetcher de producción. Entra en la fase de wiring.
- SerpAPI y Google comparten el mismo `engine=google_flights`, así que sus precios
  pueden venir del mismo underlying con marca de tiempo distinta. Tratar la
  deduplicación entre fuentes como trabajo futuro, no se hizo aquí.
