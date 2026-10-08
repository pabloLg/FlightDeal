# FLIGHT-SOURCE-AGGREGATION.md

## 1. Objetivo

Agregar resultados de multiples fuentes de vuelos en una sola ejecucion, preservando la semantica existente (first-wins cuando no hay agregacion explicita), evitando duplicados entre fuentes mediante una clave de itinerario puro (sin sourceId), extendiendo el contrato de dominio para URLs de reserva (sin tocar BD aun), controlando el presupuesto entre fuentes (margen 3s), y manteniendo fail-closed, ""no_flights"", scheduler/alerts/historial intactos. No modificar flight_options.dedupe_key ni el contrato DB existente.

## 2. Alcance

- Agregacion secuencial (no paralela) entre fuentes configuradas, con merge controlado por presupuesto.
- Dedupe entre fuentes usando itineraryDedupeKey (itinerario puro: outboundLegs+inboundLegs sin sourceId).
- Extender FlightOption en dominio con bookingUrl?, bookingUrls? (opcional). Sin migracion DB por ahora (trazabilidad en raw_result + attempts).
- Politica de margen: antes de iniciar siguiente fuente, si remaining < FLIGHT_SOURCE_TIMEOUT_MARGIN_MS = 3000 ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ no iniciar esa fuente.
- Paradas: solo MAX_SOURCES_PER_RUN (configurable via FLIGHT_MAX_SOURCES_PER_RUN, default 3), timeout tecnico global (deadline), fuente no elegible/degraded, condiciones de error/estado existentes. Sin criterio ""suficientes resultados"".
- Persistencia: conservar precio mas barato al mergear duplicados entre fuentes. Guardar selectedSource + sources[] involucradas.
- MockFlightSource solo para dev/test. No mezclar precios sinteticos en cadena real.
- No UI changes.

## 3. Decisiones tomadas (confirmadas)

1. Dedupe entre fuentes: Opcion B ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â crear itineraryDedupeKey (itinerario puro, sin sourceId) solo para agregacion entre fuentes. NO modificar optionKey existente. Mantener contrato flight_options.dedupe_key tal cual.
2. Booking URLs: Opcion A ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â extender FlightOption en dominio con campos opcionales (bookingUrl?, bookingUrls?) sin tocar BD por ahora. Trazabilidad en raw_result + attempts.
3. Margen: aplicar antes de iniciar siguiente fuente si remaining < FLIGHT_SOURCE_TIMEOUT_MARGIN_MS=3000.
4. Paradas: solo MAX_SOURCES_PER_RUN, timeout tecnico global, fuente no elegible/degraded, condiciones error/estado existentes. Sin ""suficientes resultados"".
5. Precio duplicados: conservar precio mas barato. Guardar selectedSource + sources[] involucradas.
6. MAX_SOURCES_PER_RUN desde env FLIGHT_MAX_SOURCES_PER_RUN=3 (default). Configurable.
7. No UI changes.
8. No paralelizar. Sequential merge with controlled budget.

## 4. Estado actual (inspeccionado)

- chain.ts (first-wins): if (!result.degraded) return { result, sourceId: source.id, attempts } (lineas ~144-146). Usa deadline = Date.now() + budgetMs (linea ~93). Comentarios reflejan first-wins y que ""no_flights"" con degraded=false es valido (stop). Budget exhausted ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ marca degraded y retorna ultimo (lineas ~96-114).
- execute-search.ts: upsert por search_id,dedupe_key usando option.id actual ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ dedupe_key: option.id. Inserta flight_prices solo para precios observados (flatMap + price===undefined ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ []). Guarda sourceId, attempts, durationMs, optionCount, message en raw_result. no_flights (options.length===0, degraded=false) marca completed con message: ""no_flights"" (lineas ~97-110). degraded ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ status degraded, no persiste precios (lineas ~80-95). Alerts intactos.
- option-key.ts: incluye sourceId ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ clave acoplada a fuente. Necesario itineraryDedupeKey separado para merge entre fuentes.
- types.ts: FlightOption sin bookingUrl/bookingUrls.
- google-flights-scraper-source.ts: usa optionKey(""gf"", ...) para itinerario enriquecido; tests usan fixtures.
- Mock solo dev/test; resolveChain filtra mock si hay fuentes reales.
## 5. Principios de diseño

- Preservar compatibilidad hacia atras: no modificar optionKey, no cambiar contrato flight_options.dedupe_key, no migrar BD en esta fase.
- Fail-closed: errores/structure mismatch → degraded, nunca persistir corrupto.
- Semantica "no_flights": options.length==0 y degraded==false es resultado valido y finaliza.
- First-wins solo aplica cuando NO hay agregacion o cuando no se agregaran fuentes adicionales por margen/deadline/MAX_SOURCES.
- Agregacion secuencial, sin paralelismo.
- Mock solo dev/test; cadena real nunca mezcla mock.
- Solo precios observados en flight_prices (ningun relleno a 0).
- Degraded no aporta opciones; failed no borra resultados anteriores; scheduler/alerts/historial intactos.

## 6. Definiciones

- itineraryDedupeKey: clave estable derivada de itinerario puro (sin sourceId). Generada desde outboundLegs+inboundLegs con misma normalizacion que legPart (orden estable). Ej.: hash/stable join de legPart(outbound[]) + "|" + legPart(inbound[]).
- selectedSource: sourceId de la fuente cuya opcion se selecciono al conservar precio mas barato (o fuente primaria si se mantiene).
- sources[]: lista de sourceId involucradas en esa opcion mergeada (todas las fuentes que devolvieron ese itinerario).
- bookingUrl/bookingUrls: URLs de reserva (dominio, opcionales). No persisten en BD ahora; trazabilidad en raw_result/attempts.

## 7. Cambios en dominio (tipos)

- types.ts (FlightOption): agregar campos opcionales `bookingUrl?: string`, `bookingUrls?: string[]`.
- Crear helper `itineraryKey(outboundLegs: FlightLeg[], inboundLegs: FlightLeg[]): string` (separado de optionKey). No modifica option-key.ts. Puede ubicarse en `src/domain/sources/itinerary-key.ts` o añadirse junto a option-key sin romper usos existentes.
- Mantener optionKey(sourceId, ...) intacto (usado por scrapers para id interno si fuera necesario y para compatibilidad).

## 8. Configuración (env)

- FLIGHT_MAX_SOURCES_PER_RUN: number, default 3 (MAX_SOURCES_PER_RUN).
- FLIGHT_SOURCE_TIMEOUT_MARGIN_MS: number, default 3000 (margen antes de iniciar siguiente fuente).
- SCRAPE_BUDGET_MS: existente (presupesto global).
- FLIGHT_SOURCES: existente (orden secuencial).

## 9. Punto exacto first-wins

En `chain.ts` línea ~144-146:
```ts
if (!result.degraded) return { result, sourceId: source.id, attempts };
```

Regla: first non-degraded source wins. "no_flights" con degraded=false → return inmediato (cadena se detiene). Esto NO cambia con agregación si solo hay 1 fuente o si no hay tiempo/fuentes para agregar. La agregación reemplaza el comportamiento de "retornar primera exitosa" por "agregar secuencialmente hasta límite" SOLO cuando se implemente AggregationChain; el cambio debe preservar el punto exacto anterior para rutas no-agrupadas o cuando MAX_SOURCES_PER_RUN<=1.

## 10. Modelo de agregación

- SourceResults[]: para cada fuente intentada (exito/degraded/failed) se registra options (opciones retornadas, solo si no degraded), degraded, message, ms, sourceId.
- Aggregation: estructura acumulada { options: FlightOption[] merged, byItinerary: Map<itineraryDedupeKey, MergedOption>, sourcesAttempted: string[], sourcesIncluded: string[], selectedSource: string|null, totalMs: number }.
- MergedOption: { option: FlightOption (versión seleccionada: precio más barato), priceMin: number, priceMax?: number, sources: string[], selectedSource: string } (trazabilidad entre fuentes).
- Política merge: si itinerario existe → conservar opción con precio más barato. Guardar sources[] = union, selectedSource = fuente de la opción seleccionada, actualizar priceMin/priceMax. Si nuevo precio igual, política establecida: preferir primera fuente incluida o mantener existente (no cambia comportamiento).

## 11. Política de ejecución secuencial con margen

1. Calcular deadline global = now + budgetMs (igual que chain actual).
2. Para cada fuente en orden FLIGHT_SOURCES: 
   - Si fuentes intentadas >= MAX_SOURCES_PER_RUN → break (parada).
   - remaining = deadline - now; si remaining < FLIGHT_SOURCE_TIMEOUT_MARGIN_MS (3000) → no iniciar esta fuente; registrar skip por margen y continuar/break según regla (no iniciar).
   - Intentar fuente (llamar source.search). Capturar ms, degraded, message.
   - Si error (throw) → tratar como degraded (igual que chain). No romper chain global.
   - Si degraded → no agrega opciones; registra intento; puede continuar a siguiente fuente si cumple margen y count < MAX.
   - Si ok (no degraded) → agregar opciones a merge set via itineraryDedupeKey. Registra sourcesIncluded += sourceId. Puede continuar si margen/count OK.
3. Resultado final: construir FlightSourceResult con options mergeadas (orden estable: p.ej. por price asc luego por itineraryKey asc), currency=params.currency, structureVersion coherente (puede conservar del primer exito o 0 si ninguno ok), degraded = (merged.options.length==0 AND todas las fuentes intentadas resultaron degraded/failed) ? true : false (pero preservar semantica no_flights cuando no hay opciones y ninguna degradacion grave que impida resultado valido). Especificamente: si tras agregar no hay opciones → tratar como "no_flights" efectivo con degraded=false solo si al menos una fuente devolvió degraded=false con options.length==0? O mantener regla: resultado valido (no degraded) si alguna fuente retornó no-degraded. Si todas degradadas → degraded=true.

## 12. Compatibilidad con semántica existente

- "no_flights": cuando una fuente retorna options=[] y degraded=false → agregado no añade nada; resultado agregado puede seguir con [] y degraded=false → se persiste como completed con message "no_flights" (igual que líneas 97-110).
- degraded no aporta: fuentes degraded no añaden opciones.
- failed (throw) → tratado como degraded, no borra resultados anteriores ya mergeados.
- first-wins: si MAX_SOURCES_PER_RUN==1 o margen bloquea segunda fuente, comportamiento equivale a first-wins (primera no-degraded retorna/queda).
- Mock: solo dev/test; resolveChain ya excluye mock si existen fuentes reales. Agregador debe respetar esto.
- flight_prices: solo opciones observadas (ningún 0). Al persistir, execute-search recibe options (mergeados). Se mantiene lógica actual (flatMap por price observado).
- dedupe_key BD: se mantiene usando option.id tal cual (no cambia). La agregación afecta qué options se generan/unen, no el contrato de BD.

## 13. Integración con chain.ts y execute-search.ts

- Opción 1 (mínima): introducir `AggregationChain` paralelo a `searchWithFailover`. Mantener `searchWithFailover` intacto (first-wins) para compatibilidad; usar nuevo en path de agregación si configurado (flag opcional no necesario si MAX_SOURCES_PER_RUN>1 o flag `FLIGHT_AGGREGATE=true`? Pero decisión 8: secuencial merge con controlled budget; plan debe especificar punto de integración sin romper).
- Opción recomendada (sin romper API): añadir `searchWithAggregation(sources, params, budgetMs)` que implementa merge secuencial con margen/MAX_SOURCES. `searchWithFailover` puede seguir existiendo; el llamador (execute-search/runExecution) decide cuál usar basado en count/config. Alternativa: refactor interno manteniendo firma ChainOutcome.
- `ChainOutcome.attempts`: ampliar con campos para trazabilidad agregada (sourceId, degraded, ms, message, included:boolean). No romper estructura (agregar opcionales).
- `raw_result` en search_executions: incluir `aggregation` { mergedCount, sourcesAttempted, sourcesIncluded, selectedSource } además de sourceId/attempts/durationMs. Mantener estructura existente.
- execute-search.ts: cuando usa resultado agregado, los `option.id` deben seguir siendo estables para upsert (puede usarse optionKey(sourceId,...) existente en cada opción mergeada? O mantener id generado por scraper). Importante: DB usa dedupe_key = option.id actual (línea 121). La agregación NO cambia dedupe_key; si se fusionan, la opción seleccionada (precio menor) es la que se persiste (con su id actual correspondiente a selectedSource) — esto preserva contrato. Las fuentes involucradas van en `sources[]`/raw_result, no en dedupe_key.

## 14. Abstracción FlightSource (sin cambios requeridos)

- Interfaz FlightSource intacta. Cada fuente sigue retornando FlightSourceResult con sus propias opciones (con sus propios ids generados). Agregador opera sobre resultados, no modifica fuentes. MockFlightSource solo dev/test.

## 15. Booking URLs (dominio, sin BD)

- types.ts: `FlightOption` añade `bookingUrl?: string`, `bookingUrls?: string[]` (opcionales).
- Fuentes que dispongan de datos pueden poblar estos campos (no obligatorio).
- No se añaden columnas a flight_options. Trazabilidad: guardar en raw_result (p.ej. `optionsMeta` o por intento) y en attempts si aplica. No persistir URLs en BD en esta fase.

## 16. Tests a cubrir (16 casos) + existentes verdes

Se proponen 16 casos mínimo (alineados a decisiones):
1. Single source ok → same as first-wins, merged count = returned count.
2. Two sources, no overlap → union.
3. Overlap same itinerary different prices → keep cheaper, sources[] includes both, selectedSource set.
4. Overlap same price → keep existing (stable), selectedSource unchanged or primera; no cambio.
5. Second source degraded → ignore options, keep first; attempts recorded.
6. Second throws → treated as degraded, first preserved.
7. First degraded (no options), second ok → use second (no first-wins lost).
8. All degraded → degraded=true, no options, attempts recorded.
9. All return no_flights (degraded=false, []) → completed with no_flights, no persist.
10. Margin blocks next source (remaining < 3000) → skip, do not start, attempts include skip reason.
11. Deadline exhausted mid-chain → degraded chain outcome, no new source started.
12. MAX_SOURCES_PER_RUN=3, 4 configured → only 3 attempted.
13. Mock never used when real sources exist (respect resolveChain).
14. flight_prices only for observed (no zeros) with merged results.
15. Booking URLs in domain only (not persisted) — verificado via raw_result.
16. itineraryDedupeKey ignores sourceId (different sourceId same legs → deduped).

Mantener tests existentes verdes. Añadir tests unitarios para aggregator/merge y para chain con agregación.

## 17. Métricas y auditoría

- raw_result.extends with `aggregation: { mergedCount: number, sourcesAttempted: string[], sourcesIncluded: string[], selectedSource: string|null, maxSourcesPerRun: number }`.
- attempts[] mantiene sourceId, degraded, ms, message, included (bool).
- durationMs total ejecución.
- sourceId en ChainOutcome puede reflejar selectedSource o primera fuente incluida (mantener compatibilidad con actual).
- Sin nuevas tablas.

## 18. Notas de implementación

- **Ejecutado el 2026-10-08 en revisión "tarjeta por fuente" (decisión del usuario)**: se cableó `searchWithSequentialMerge` en `execute-search` SUSTITUYENDO al failover (sin flag; vuelta atrás vía `FLIGHT_MAX_SOURCES_PER_RUN=1`), `no_flights` verificado DETIENE la cadena (doctrina F8), y NO se fusionan precios: cada fuente persiste sus filas con `source_id` (migración `20261008203000`) y la UI muestra badge de fuente. `mergeFlightOptions`/`buildAggregationContext`/`searchWithFailover` eliminados con sus tests. La normalización cruzada NO se implementó (prefijos intactos por decisión; sin consumidor tras eliminar la fusión — se retomará si llega el agrupado visual).
- Mantener option-key.ts intacto salvo lo ya hecho. Añadir itinerary-key.ts o función interna.
- No modificar schema/migraciones DB.
- Usar abstracción FlightSource (sin cambios interfaz).
- MockFlightSource solo dev/test.
- Preservar scheduler/alerts/historial intactos.
- Cumplir Node 22, lint/typecheck/tests/build tal como AGENTS.md.
