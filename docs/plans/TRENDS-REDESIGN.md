# FlightDeal — Rediseño de Tendencias

> Estado: implementado y **desplegado en produccion el 2026-10-13** (merge
> `dev` → `master`). Alcance acordado con el usuario: pagina independiente
> `/trends` + resumen compacto en el Dashboard. **Sin tocar** esquema,
> migraciones, RLS, scrapers, cadena de fuentes, scheduler, alertas ni
> dependencias.

## Datos

Fuente unica: `price_stats_daily` (agregado diario por `search_id`, **EUR**,
conservado indefinidamente). Se usa tambien `searches` (condiciones
comparables), `search_executions.finished_at` (ultima comprobacion real) y
`profiles.currency` (solo para el aviso EUR). RLS acota las tres tablas al dueno.

- `stats_date` = dia del agregado. `finished_at` = momento de la ultima
  comprobacion; se muestran por separado y no se confunden.
- No hay precio por vuelo en el agregado: la serie y la variacion describen el
  **minimo diario observado por busqueda**, y se rotulan asi.

## Reglas

- **Ruta = una busqueda.** Sus condiciones (origen, destino, fechas salida y
  regreso, tipo de viaje) ya la hacen comparable. Dos busquedas del mismo par de
  ciudades con fechas distintas son dos tarjetas; una ida nunca se fusiona con
  una ida y vuelta.
- **Periodos** por fecha ISO: 7 dias = hoy + los 6 anteriores; 30 dias = hoy + los
  29 anteriores; «Todo» = sin cota inferior. Se excluye siempre el futuro.
- **Variacion** = `(ultimoMin - primerMin) / primerMin` con el minimo diario del
  primer y del ultimo dia con datos dentro del periodo, mismo `search_id`.
  `null` con menos de dos dias distintos. Se etiqueta como variacion del minimo
  diario observado: no es el mismo vuelo ni implica disponibilidad.
- **Indicadores** (rutas con datos, minimo observado, rutas con bajada) se
  recalculan sobre el conjunto ya filtrado.

## Dashboard

Hasta 3 rutas, en presentacion: primero las observadas en la ventana de 7 dias,
dentro de ellas las que tienen bajada demostrable, y se completa con las mas
recientes. **No** es un ranking de mejores oportunidades; solo decide que entra
en la tarjeta. Enlace «Ver todas las tendencias» a `/trends`.

## Implementacion

- `app/src/domain/trends/summary.ts` (+ `summary.test.ts`, 14 tests): helpers
  puros. `buildTrends`, `summarize`, `filterRoutes`, `sortRoutes`,
  `pickDashboardRoutes`, `periodFrom`, `shiftIsoDate`.
- `app/app/trends/page.tsx`: server, `force-dynamic`, auth + RLS, carga todo el
  historico una vez.
- `app/components/trends/trends-view.tsx`: cliente; periodo, filtros y orden
  recalculan tarjetas e indicadores sin round-trips. Grafica SVG en linea (sin
  dependencia); con menos de dos dias muestra «Historico insuficiente para
  mostrar la evolucion». Panel lateral sticky en escritorio, plegable en movil.
- `app/app/dashboard/page.tsx` y `app/components/layout/header-nav.tsx`.

## Verificacion

- `npm run typecheck`, `npm run lint` y `npm run build`: OK. `npm test`: 251 tests
  en 31 ficheros (14 nuevos de Tendencias).
- End-to-end contra la BD real con el usuario demo: `/trends` sin sesion redirige
  a `/login`; con sesion, cambiar de periodo recalcula tarjetas e indicadores
  (7 d: 10 rutas / 4 bajadas; 30 d: 11 rutas; «Todo»: 12 rutas), las rutas con un
  solo dia muestran «Historico insuficiente», y el Dashboard muestra el resumen
  de 7 d con el enlace a `/trends`.

## Limitaciones

- Carga de todo el historico en cliente: aceptable a este volumen (aprox. una
  fila por busqueda y dia); si creciera, se paginaria por periodo.
- Sin FX: el historico es EUR; con otro perfil aparece el aviso y no se mezclan
  monedas.
- Se incluyen todas las busquedas con datos, tambien las `enabled = false`.
