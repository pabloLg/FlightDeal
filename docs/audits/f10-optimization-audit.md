# F10 — Optimización · Auditoría (slice 3, verificado 2026-09-29)

Cierra los dos huecos reales que quedaban de F10 tras los slices 1 (métricas) y 2 (Chromium en
Vercel): **retención que nadie ejecutaba** y el endpoint de reintento auditado de D6.

## Entregables

### 1. Retención efectiva (`app/api/scheduler/tick/route.ts`)

- `run_retention()` (F4, `20260925120910_f4_historical.sql:52`) **no tenía caller**: nada purgaba
  `flight_prices` en el proyecto entero. Ahora el tick la llama con cliente `service_role` (la función
  es `security definer` y nunca tuvo `revoke`, así que `service_role` ya podía ejecutarla → cero
  migraciones).
- Se ejecuta **antes** de `scheduler_tick()` y **antes** del loop de scraping: es un `DELETE` con
  índice sobre `observed_at` (barato) y así el presupuesto de 45 s queda entero para los scrapes.
- Corre también en ticks sin nada que raspar (la llamada está antes del early return de 0 ejecuciones).
- La respuesta expone `pricesPurged` (mismo criterio de F10: métricas en la respuesta, sin tablas
  nuevas).

### 2. `POST /api/admin/sources/retry` (D6)

- `app/api/admin/sources/retry/route.ts`, `runtime = nodejs`, `maxDuration = 60`.
- Auth: `Authorization: Bearer <CRON_SECRET>` — reutiliza el secret que ya existía para el cron en vez
  de inventar un `ADMIN_SECRET` paralelo.
- Body `{ searchId }`; opera con `createAdminClient` (service_role).
- **Auditoría sin tabla nueva**: cada intento es otra fila de `search_executions`, y `runExecution`
  acepta un 5º parámetro `context` que se mezcla en los cuatro `raw_result` que escribe →
  `{"actor": "admin", "retriedFrom": "<id de la ejecución fallida>"}`. La cadena de ejecuciones **es**
  el rastro de auditoría.
- El scrape se **espera** dentro de la invocación (mismo patrón que el tick; nunca `void`, que es el
  bug de F7) y devuelve `status`/`error`/`ms` de la ejecución resultante.
- Guard en función pura `src/domain/search/retry-guard.ts` (`canRetry`), 429 con motivo:
  - `execution_in_flight` si la última está `pending`/`running` (mismos estados que el CHECK de
    `search_executions`).
  - `last_execution_completed` si la última terminó bien: reintentar sobre un `completed` no es un
    retry, es falsificar una ejecución nueva.
  - `cooldown` (15 min) **solo si la última ejecución fue ya un reintento admin**. Un `degraded`
    recién salido del cron sí se puede reintentar al instante, que es justo cuando el operador acaba
    de arreglar la causa.
- `// ponytail:` la secuencia guard→insert deja una ventana de milisegundos en la que un tick
  simultáneo podría lanzar la misma búsqueda dos veces. Se cierra con un índice único parcial si algún
  día el reintento deja de ser cosa de un solo operador.

### 3. Refactor compartido (`src/domain/search/execute-search.ts`)

- `runSearchById(db, searchId, executionId, context?)` extraído del helper privado que vivía dentro
  de `tick/route.ts` (`runSearchExecution`): carga búsqueda + moneda del perfil y ejecuta. Lo usan el
  cron y el reintento, sin duplicar las dos queries.
- `runExecution(..., context?)` mezcla el contexto de auditoría en los 4 sitios donde escribe
  `raw_result` (`degraded`, `completed` sin opciones, `completed` con opciones, `failed`).

Sin migración, sin env nueva, sin dependencia nueva.

## Verificación (local, Supabase + `next dev`)

### 1. Retención purga de verdad
Se insertó una fila de `flight_prices` con `observed_at = now() - 4 months`:

```
POST /api/scheduler/tick → {"executions":0,"pricesPurged":1}      (mismo día, ya no había nada que raspar)
select count(*) … where observed_at < now() - interval '3 months' → 0
```

### 2. Retry: todas las rutas del guard

| Caso | Resultado |
|---|---|
| sin `Authorization` | `401` |
| body no JSON | `400` |
| body sin `searchId` | `400` |
| `searchId` inexistente | `404` |
| última ejecución `completed` | `429 last_execution_completed` |
| última `degraded` y era retry hace 1 min | `429 cooldown` |
| última `degraded` y era retry hace 1 h | `200` + ejecución nueva `completed` |

### 3. Rastro de auditoría

```
55e68961… | completed | {"actor":"admin","attempts":[{"ms":407,"degraded":false,"sourceId":"mock"}],
                        "sourceId":"mock","durationMs":445,"optionCount":3,
                        "retriedFrom":"850a5702…"}                     ← ejecución degradada anterior
850a5702… | degraded  | {"attempts":[…],"sourceId":"mock","durationMs":478,"optionCount":3}
```

### 4. Checks
`npm run typecheck`, `npm run lint`, `npm test` (**96 tests, 12 ficheros**, 5 nuevos del guard),
`npm run build` (ruta `ƒ /api/admin/sources/retry` en el manifiesto). Todo verde.

## Pendiente de F10

- F6 Telegram (el contrato `alerts_edge` + `alert_dispatches` ya está listo y el endpoint lo deja
  `dispatched`).
- Aplazados por decisión del usuario: flexible-dates en Ignav, regreso de SerpAPI (2ª request).

## Verificación en producción (2026-10-01)

Proyecto `flight-deal` (scope `pablo-cdfb`), Supabase hospedado `extpuygtrjvqzkmouqef`. Desplegar desde
la **raíz** del repo: con Root Directory `app` en el proyecto, desplegar desde `app/` lo aplica dos
veces y falla con `No Next.js version detected`.

### Bugs que sólo aparecen en producción

Cinco, y el mismo motivo raíz en todos: **la invocación de Vercel tiene un tope de 60 s y nada dentro
estaba acotado a él**. Cada fallo deja la ejecución a medias, y una ejecución a medias bloquea su
search para siempre.

1. **`playwright-core` fuera del bundle** (`Cannot find module .../browsers.json`): `serverExternalPackages`
   + trace de `./node_modules/playwright-core/**/*` en `next.config.ts`.
2. **El lease se borraba al entrar en la ejecución**: `mark()` limpiaba `lease_holder`/`lease_expires_at`
   también en la marca `running` inicial, así que `release_expired_leases()` no podía recuperar una
   ejecución cuyo runner murió a mitad. `runExecution` marca `running` sin tocar el lease.
3. **El reaper sólo miraba el lease**: un retry manual inserta `pending` sin lease, así que su ejecución
   muerta tampoco era recuperable. `release_expired_leases()` recupera ahora también por edad
   (`created_at < now() - grace`) y el endpoint de retry lo llama antes de evaluar `canRetry`.
   Migración `20261001210000_f10_lease_reaper_by_age.sql`.
4. **Sin presupuesto por búsqueda**: dos esperas de 45 s dentro de una fetch ya superan el tope. El
   deadline lo calcula `GoogleFlightsScraperSource.search()` y lo reciben `HtmlFetcher`/`ReturnLegsFetcher`;
   `stepTimeout()` acota cada espera a lo que queda y lanza `budget_exhausted:<paso>` en vez de esperar.
   Una búsqueda son **dos** cargas (resultados + regreso), por eso el presupuesto va por búsqueda y no
   por fetch. El chain tampoco pregunta a una fuente nueva si se agotó (`budget_exhausted:chain`).
5. **Caché de navegador sin validar**: una lambda caliente puede volver con el proceso Chromium ya
   muerto (`Target page, context or browser has been closed`); `getBrowser()` comprueba `isConnected()`
   antes de reutilizar.

Además `httpJsonFetcher` no tenía timeout: una SerpAPI/Ignav colgada se comía la invocación. Ahora
`AbortSignal.timeout(10_000)`.

### Tiempos reales (Vercel Hobby, `maxDuration = 60`)

| fase | ms |
|---|---|
| launch Chromium (`@sparticuz/chromium`) | 3 167 |
| HTML de resultados | 4 017 |
| búsqueda completa MAD→BCN (ida + regreso) | 9 830 |
| búsqueda completa MAD→LHR (flex 5, sin regreso) | 6 221 |
| tick con 2 búsquedas | 19 194 |
| SerpAPI (verificado local con clave real) | 2 390 |
| Ignav (verificado local con clave real) | 5 090 |

En local la misma búsqueda tarda 9 015 ms y el parseo de 2.4 MB son 11 ms: **el coste no es la CPU ni
Google, es el margen del plataforma**. Con `SCRAPE_BUDGET_MS = 30000` y el tick adaptativo (comprueba que
la *próxima* búsqueda quepa, no sólo el tiempo transcurrido) el tick termina sin matar la invocación.

### Cadena de failover

`FLIGHT_SOURCES=google_flights,serpapi,ignav`. Ambas APIs verificadas con clave real (SerpAPI 17 opciones
112–463 EUR, Ignav 235 opciones 126–531 EUR; rangos compatibles con los de Google). En el tick de
verificación respondieron las dos por `google_flights`, que es lo esperado: los fallbacks sólo arden
cuando Google degrada, y para entonces el chain puede quedarse sin presupuesto.

### Notas de operación

- El Management API `POST /v1/projects/<ref>/database/query` **trunca los cuerpos `$$` multi-línea**
  (`unterminated dollar-quoted string`): los `create function` hay que enviarlos en una línea.
- `vercel curl` necesita `$env:VERCEL_TOKEN`; con `--token` el valor se reenvía al curl y falla.
- `supabase_migrations.schema_migrations` no existe en el proyecto hospedado: las migraciones aplicadas
  por API no quedan registradas, así que `supabase db push --linked` intentaría reaplicarlas todas.

### Pendiente

- Vercel **Deployment Protection** sigue activa: la app sólo responde vía `vercel curl`. Hay que
  desactivarla a mano en el dashboard para usarla desde el navegador.
- El cron real (`0 6 * * *`) aún no ha disparado; los smokes son manuales.
- Con ~10 s por búsqueda y 45 s de presupuesto, el tick cubre ~2 búsquedas por día en plan Hobby. Con más
  searches, `p_batch_size` sobra y manda el reparto real por presupuesto.
