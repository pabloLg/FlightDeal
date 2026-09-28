---
name: google-flights-scraper
description: 'Build or maintain the GoogleFlightsScraperSource for the Flight Deal Tracker: deterministic server-side TFS URLs, Playwright navigation, consent-only cookies, structure-guard, fixtures, fail-closed behavior. Use when working on the scraper, search execution, fixtures, or structure-version handling.'
---

# Google Flights Scraper (FDT)

Componente fuente PRINCIPAL del proyecto Flight Deal Tracker. Interfaz `FlightSource` en el dominio.

## Reglas congeladas (no cambiar sin validación)

- URL: TFS construido server-side, determinista. NUNCA interactuar con la UI para construir la búsqueda.
- Parámetros fijos en MVP: `hl=es` `gl=ES` `curr=EUR`.
- Cookies SOLO de consentimiento anónimo (p. ej. `SOCS`). PROHIBIDO login/cuenta/NID/user.
- Fail-closed: si hay sospecha de bloqueo o estructura inválida → NO persistir datos, marcar ejecución fallida, degradar.
- NO evasión de CAPTCHA/anti-bot (sin resolvers, sin rotación de IP agresiva).
- Rate limit conservador + backoff; endpoint `POST /admin/sources/retry` para reintentos manuales auditados.

## Arquitectura de componentes

1. `buildTfsUrl(params)` — genera `tfs=` y query completa. Funciones puras, testables.
2. `navigate(session, params)` — pasos de navegación Playwright (separado del parser).
3. `sessionFactory` — contexto anónimo con cookies de consentimiento, timeouts, retries con backoff.
4. `parsePage(html)` — extrae datos (separado de navegación). Devuelve `raw[]`.
5. `normalize(raw)` — normaliza a esquema interno (separado).
6. `structureGuard(html)` — estructural: markers `Google Vuelos` (título) + `AF_initDataCallback({key: 'ds:0'` + `ds:1` + payload ds:1 JSON válido. **Atención (2026-09-25)**: una página válida con 0 opciones es resultado legítimo `no_flights` (NO degradar); degradar solo si estructura rota (`missing_marker:*`) o ds:1 ausente/corrupto (`parse_failed:ds1_missing_or_corrupt`). `source_structure_version` nuevo + fail-closed al cambiar.
7. `fixtures/` — muestras reales `.html` (ruta con ofertas: `mad-bcn-roundtrip` 17 opciones; sin resultados real: `aa-bcn-no-results`, ruta AAA→BCN donde Google devuelve 0; par del click-through: `mad-bcn-clickthrough.html` + `mad-bcn-return-legs.txt`, capturados en el MISMO run). Captura real vía Playwright MCP → base64 → reconstruir con write tool (MCP no puede escribir archivos en Windows). Los `.html` grandes se podan a `<title>` + marker + scripts `AF_initDataCallback({key: 'ds:N'` (55 KB en vez de 2,5 MB).
8. `playwright-fetcher.ts` — navegación real: `playwright-core` (navegador externo, `CHROMIUM_PATH`), 1 navegador por proceso, contexto anónimo por búsqueda, cookie `SOCS` + `button:has-text("Aceptar todo")` si hay muro de consentimiento, `headless`. `browserPlan(env)`: `CHROMIUM_PATH` > `VERCEL` (wireframe `@sparticuz/chromium`, navegador comprimido en Brotli y descomprimido a `/tmp`) > navegador propio de playwright-core. En Vercel el bundle completo no cabe (límite 250 MB), por eso el wireframe.
9. `rpc-return-legs.ts` — parser del regreso. El tramo de vuelta **no** está en el HTML del servidor: se renderiza desde el RPC `POST /_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetShoppingResults` disparado al hacer click en la primera tarjeta (`element.click()`; la tarjeta `div[role="link"][aria-label*="euros"]` intercepta el puntero). Body = frame stream `)]}'` + líneas `<len>` + JSON de una línea; regresos en `data[3][0]` (misma forma que `ds:1`) y el outbound seleccionado dentro de `data[1]` (búsqueda recursiva, el índice varía).

## Idas de ida, solo en vivo (2026-09-28)

- La página de ida dispara **su propio** `GetShoppingResults`, y a veces **después** del click → quedarse con "la primera respuesta" lee la lista de ida y no hay regreso. Solución: ignorar requests previos al click (`WeakSet` de `Request`) y tomar el primer cuerpo que **parsea** como lista de regreso.
- El handler de la tarjeta no siempre está bound cuando aparece el shell → el click no dispara ningún RPC. Solución: re-click idempotente con deadline.
- El shell se sirve a veces **sin `ds:1`** (~1 de cada 3) → un reload en el fetcher antes de degradar la fuente.
- `ds:1` trae **dos** listas de opciones: `data[2][0]` = bloque "mejores opciones" (3, la primera es la que Google marca como mejor) y `data[3][0]` = lista completa (17 en el fixture MAD→BCN). `parseOptionsPayload` lee las dos, best-first y con dedupe por `optionKey`; leer solo `data[3]` descarta los 3 más baratos.
- El precio del RPC de regreso es el **total ida y vuelta**, no el precio del vuelo de vuelta.
- En el RPC de regreso `data[2]` viene `null`: solo hay lista de regresos en `data[3]`. Por eso el parser de ida y el de regreso comparten la misma función.

## Flujo de ejecución (resumen)

```
search(params) {
  url = buildTfsUrl(params)
  session = await sessionFactory.create()
  try {
    html = await navigate(session, url)
    guard = structureGuard(html)
    if (!guard.ok) → throw StructureMismatchError (fail-closed)
    raw = parsePage(html)
    return { results: normalize(raw), source: 'google_flights' }
  } catch (e) {
    markFailed(...)  // degradar, no rethrow al usuario sin clasificar
  } finally { await session.close() }
}
```

## Tests

- Fixtures deben ir acompañados de `expected.ts` con resultados normalizados esperados.
- Structure-guard: añadir test que simule HTML "roto" y verifique fail-closed (no guarda nada corrupto).
- Nunca ejecutar tests que dependan de red contra fixtures de Google en CI; usar MockFlightSource.

## Notas de evolución

- Revisar regularmente versiones de estructura (`source_structure_versions`).
- Guardar respuestas reales como fixtures cuando el usuario autorice (con control de privacidad).