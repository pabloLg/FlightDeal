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
6. `structureGuard(page)` — valida selectores clave / shape. Si cambia: `source_structure_version` nuevo + fail-closed.
7. `fixtures/` — muestras reales `.html` (10 rutas: ofertas, sin resultados, moneda, multi-ciudad, blocked, partial, etc.) para tests deterministas.

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