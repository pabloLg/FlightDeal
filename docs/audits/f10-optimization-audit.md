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

- **Verificación en producción** (criterio de aceptación de F10): `vercel link`, env en Vercel con el
  Supabase **hospedado** (en `app/.env` la URL es `localhost:54321`), `vercel --prod`, `curl` al tick y
  lectura de `raw_result.attempts[].ms` / `durationMs`. En especial: si `google_flights` degrada (wireframe
  de Chromium en `/tmp`) o cae a SerpAPI/Ignav. Bloqueante: login de Vercel.
- Caché/batch por ruta: con ~10 s por ruta y lote 10, el presupuesto de 45 s solo cabe ~4 y el resto
  queda `deferred` al siguiente tick. Se decide con los `ms` reales de producción (bajar
  `p_batch_size` antes que añadir caché).
- F6 Telegram (el contrato `alerts_edge` + `alert_dispatches` ya está listo y el endpoint lo deja
  `dispatched`).
- Aplazados por decisión del usuario: flexible-dates en Ignav, regreso de SerpAPI (2ª request).
