# FlightDeal — Rediseño frontend y extensión de credenciales

> Documento de auditoría y plan. Identidad: **FlightDeal — Tu radar de viajes.**
> Alcance acordado 2026-10-09: rediseño del frontend en 6 fases + correcciones de
> honestidad de datos (P1/P2/P3) + fase de configuración de credenciales de fuentes.
> Sin nuevas funcionalidades de producto, sin nuevas fuentes, sin tocar RLS, scraper,
> scheduler, alertas ni el modelo de datos salvo las columnas indicadas.

## 1. Flujo de trabajo acordado

- Una rama por fase → PR a `master` → CI (`lint`, `typecheck`, `test`, `build`, Node 22) + preview de Vercel → revisión → **squash-merge**.
- **Producción solo cuando se elija**: deploy manual con `vercel --prod` desde la raíz. Nunca se despliega desde una rama.
- Migraciones: viajan en el PR, se aplican a la BD hospedada al abrir el PR (idempotentes) para no romper el preview. Con deploy diferido queda una ventana en que la BD tiene columnas nuevas y producción no: inofensivo, el código antiguo las ignora.
- Pendiente de confirmar en Vercel → Settings → Git: que un push a `master` **no** despliegue a producción (si lo hace, cambiar la *production branch* a una que no se use, p. ej. `release`).

## 2. Inventario verificado

### Rutas

| Ruta | Tipo | Función |
|---|---|---|
| `app/app/page.tsx` | Server | Landing pública (hero decorativo `.hero/.plane/.cloud`) |
| `app/app/login`, `signup` | Client form | Auth |
| `app/app/dashboard` | Server, `force-dynamic` | 5 queries secuenciales → hero + form + búsquedas + oportunidades + tendencias |
| `app/app/searches/[id]` | Server, `force-dynamic` | Resultados, filtros por GET, histórico, alertas |
| `app/app/settings` | Server | Moneda |
| `/api/searches/[id]` | Route Handler | POST ejecutar + GET estado (poll) |
| `/api/scheduler/tick`, `/api/admin/sources/retry` | Route Handler | Fuera del frontend |

No existe ruta `/alerts`: las alertas se ven solo dentro de `/searches/[id]`. No se crea.

### Componentes

- **UI (shadcn base-nova, 5):** `button` (cva, 6 variantes × 7 tamaños), `card` (+ header/action/description/content/footer), `input`, `label`, `checkbox`. No hay badge, alert, skeleton, select, tabs, separator ni sheet.
- **Layout:** `site-header` (server), `header-nav` (client, 3 enlaces).
- **Search:** `search-hero`, `search-form` (client), `searches-view` (client: run + poll + edición inline).
- **Deals:** `deal-card`, `featured-deals`, `flight-deal-card` (server component).
- **Dominio puro reutilizable:** `src/domain/deals/filters.ts` (parseFilters, applyFilters, airlineOptions, orden precio/duración/escalas) y `lib/flight-display.ts` (fmtDuration, buildBookingUrl, fmtFreshness).

### Tipos

`FlightSearchParams`, `FlightLeg` (con `airlineName`), `FlightOption`, `FlightOptionBookingLink`, `FlightSourceResult`. Cada página re-declara sus propios tipos locales de fila; no existe un `Search` compartido. Deuda menor, no bloqueante.

### Librerías

`lucide-react` (iconos), `tailwindcss v4`, `shadcn`, `class-variance-authority`, `tw-animate-css`, `Intl` nativo para fechas. **No hay Recharts** (el histórico son barras CSS) ni Motion. **No se añade ninguna dependencia.**

### RLS y seguridad

Las 9 tablas tienen RLS con políticas `*_owner_*`; `alert_dispatches` se acota vía `alerts_edge → searches.profile_id = auth.uid()`. El frontend usa solo el cliente SSR de usuario; el `service_role` solo vive en rutas de servidor. No se modifica nada de esto.

### Tests

17 ficheros / 133 tests. Solo 1 test de componente (`search-form.test.tsx`, RTL + jsdom). Sin E2E ni regresión visual. La infraestructura RTL/jsdom ya está montada.

## 3. Diagnóstico: 12 problemas

| # | Problema | Ubicación | Gravedad |
|---|---|---|---|
| P1 | Ordena precios comparando monedas distintas (`a.price - b.price` ignorando `currency`) | `dashboard/page.tsx` | Alta |
| P2 | Moneda hardcodeada ("EUR", "€") ignorando `profiles.currency` | `searches-view.tsx` | Alta |
| P3 | Las alertas de `/searches/[id]` no se filtran por `search_id` (RLS lo permite) | `searches/[id]/page.tsx` | Alta |
| P4 | Botón "Crear alerta" que no crea ninguna alerta | `searches/[id]/page.tsx` | Media-alta |
| P5 | Orden invertido de valor: las oportunidades van tras el formulario y las búsquedas | `dashboard/page.tsx` | Media |
| P6 | Sin módulo "Alertas recientes" en el dashboard | — | Media |
| P7 | Filtros enterrados en móvil (el `<aside>` va tras la lista) | `searches/[id]/page.tsx` | Media |
| P8 | Ejecución sin explicar el cold start y deshabilita todas las tarjetas | `searches-view.tsx` | Media |
| P9 | Formulario de edición con etiquetas ocultas y campos no editables | `searches-view.tsx` | Media |
| P10 | Estado vacío duplicado en el mismo dashboard | `featured-deals.tsx` / `searches-view.tsx` | Baja |
| P11 | Sin `prefers-reduced-motion` | `globals.css` | Baja |
| P12 | Fondo fijo en `body` (repintado en scroll móvil) | `globals.css` | Baja |

**Lo que está bien y no se toca:** la arquitectura RSC, los filtros por GET en servidor (puros y testeados), el aviso de precios >24 h, el estado `failed` honesto, `booking_links` y su handoff POST, `fmtFreshness`.

## 4. Decisiones aprobadas

1. **Sin "Mejor opción".** Las ordenaciones son precio, duración y escalas (todas ascendentes). Se documenta que no existe definición de producto para un score de mejor oferta.
2. **P1/P2/P3 se corrigen dentro de este trabajo**, en commits separados y revisables del trabajo visual.
3. **Moneda.** Cada precio muestra la moneda real de su fila. El histórico se muestra en EUR (las estadísticas se guardan en EUR) con el aviso discreto «Histórico disponible en EUR» cuando la moneda del perfil sea distinta. Sin conversiones.
4. **Dashboard.** Tendencias y Alertas recientes en una fila de dos tarjetas (`md:grid-cols-2`). Ofertas destacadas y búsquedas conservan prioridad.
5. **Credenciales:** administrador por allowlist `ADMIN_EMAIL`; cifrado AES-256-GCM con clave maestra en env; precedencia **env sobre BD**, reversible borrando la fila.

## 5. Sistema de diseño propuesto

Cero dependencias nuevas. Se formalizan los tokens existentes y se añaden semántica y estado.

- Colores existentes: `sky`, `sky-2`, `brand`, `brand-dark`, `ink`, `savings`, `opportunity`, `chart-1..5`.
- Añadir: `--state-ok`, `--state-warn`, `--state-danger`, `--state-info` (alias de los anteriores, sin valores nuevos).
- Fijar: tarjetas = radio `2xl`, botones = `lg`, tarjeta normal = `shadow-soft`, destacada = `shadow-card` + anillo.
- Tipografía: Inter; escala `display 4xl/5xl`, `title xl/2xl`, `body sm/base`, `meta xs`.
- Foco: `ring-3 ring-ring/50` extendido a los controles artesanales (`select` e `input` crudos de filtros y ajustes).
- Movimiento: solo `transition-colors`, con reset en `prefers-reduced-motion`.
- Fondo blanco/azul cielo, nunca negro. El bloque `.dark` existente queda inerte (no hay toggle) y se documenta como tal.
- Cero gráficos decorativos: el histórico pasa a un gráfico de rango mínimo–máximo en CSS, porque el rango es información real que ya existe.

## 6. Componentes

**Crear (6, todos de presentación):** `badge`, `section-card`, `empty-state`, `price-tag`, `filter-panel`, `freshness-chip`.

**Reutilizar sin cambios:** `button`, `card`, `input`, `label`, `checkbox`, `search-form`, `currency-form`, `filters.ts`, `flight-display.ts`, `flight-deal-card` (solo envoltura de badges).

**Modificar:** `searches-view`, `featured-deals`, `deal-card`, `dashboard/page.tsx`, `searches/[id]/page.tsx`, `header-nav`, `site-header`, `globals.css`.

## 7. Plan por pantallas

**Dashboard:** hero compacto con resumen de vigilancia (calculado con los datos ya cargados) → Oportunidades (una por búsqueda, orden por moneda+precio) → Mis búsquedas → fila de 2 tarjetas (Tendencias | Alertas recientes). Queries en `Promise.all`.

**Resultados:** cabecera con ruta, fechas, nº de resultados, última comprobación y enlace real a editar; `FilterPanel` responsivo; tarjetas con badge de fuente y `PriceTag`; botones de proveedor y genérico intactos.

**Histórico:** rango min–max por día con la media como marca; aviso «Histórico disponible en EUR»; nota de que es histórico observado, no predicción.

**Alertas:** filtradas por búsqueda (P3), con la condición explicada en texto.

**Ajustes:** sección «Fuentes de vuelos» (fase 7) junto a Moneda.

## 8. Riesgos de compatibilidad

- P1/P2/P3 tocan el servidor; preservan `force-dynamic`, el cliente SSR y los contratos de Server Actions (`SearchFormState = { error?: string }`, `readForm` con los `name` actuales).
- `searches-view` es cliente: recibe la moneda como prop desde el dashboard (sin query nueva).
- `alert_threshold_eur` y `price_stats_daily.*_eur` son EUR en el modelo: la moneda de display es la de la fila; sin FX (D8 sigue aparcado).
- Fase 7: el cron corre en la misma función de Vercel y puede leer Supabase, así que una credencial en BD con respaldo en env sirve para los tres caminos (manual, cron, retry) si `resolveChain` acepta credenciales inyectadas.

## 9. Fase 7 — Credenciales de fuentes

**Hechos verificados:** solo SerpAPI e Ignav requieren credenciales (`google_flights` usa el navegador, `mock` ninguna). Se leen de `process.env` en cada `resolveChain()` en los tres caminos. No existe concepto de administrador en `profiles`. Patrón de tabla solo-servidor: `source_structure_versions` (RLS sin políticas + `revoke all`). «Probar conexión» honesto solo para Ignav (`GET /api/health` gratis); SerpAPI gasta cuota y Google es estructural.

**Limitación de Vercel a documentar:** las variables de entorno son configuración del deployment y la app no puede modificarlas. Guardar en BD solo surte efecto si el runtime las lee (cambio en `resolveChain`). La UI indica el origen de cada credencial.

**Tareas:** migración `source_credentials` (RLS sin políticas + `revoke all`) → `lib/source-secrets.ts` (AES-256-GCM con `crypto.subtle`, IV de 12 bytes, prefijo de versión; clave maestra `SOURCE_SECRET_KEY` solo en env) → `resolveChain` acepta credenciales inyectadas sin cambiar orden ni `skipped` → Server Actions con autorización comprobada en servidor → UI en `/settings` (una tarjeta por fuente, nunca muestra el secreto, enlaces oficiales) → tests (no-admin rechazado, guardar/reemplazar, el payload al cliente sin secreto, logs sin secreto, precedencia y reversión) → docs (rotación, precedencia, limitación de Vercel).

## 10. Plan por fases

| PR | Rama | Contenido |
|---|---|---|
| 1 | `docs/redesign-plan` | Este documento |
| 2 | `fix/data-honesty-p1-p2-p3` | Moneda real, orden por moneda, alertas filtradas + tests |
| 3 | `feat/design-foundations` | Tokens + 6 componentes UI + nav + foco |
| 4 | `feat/dashboard` | Orden, Alertas recientes, hero compacto, `Promise.all` |
| 5 | `feat/results-filters` | `FilterPanel`, cabecera, badges |
| 6 | `feat/history-alerts` | Rango min–max, aviso EUR, condición |
| 7 | `feat/searches-forms` | Ejecución por tarjeta, cold start, formulario visible |
| 8 | `chore/polish` | Contraste, foco, táctiles, reduced-motion, limitaciones |
| 9 | `feat/source-credentials` | Fase 7 completa |

Cada PR pasa `lint`, `typecheck`, `test` y `build` en local antes de subirse.

## 11. Pruebas

- Nuevas: `rank.test.ts` (P1), `price-tag`, `badge`, `empty-state`, `freshness-chip`, `searches-view` (moneda + disable por tarjeta), `PriceHistory` (aviso EUR + 0 observaciones), y para la fase 7: autorización, guardado/reemplazo, ausencia del secreto en cliente y logs, precedencia y reversión.
- Existentes: 133 tests verdes en cada PR.
- Manual por fase: perfil en USD, ejecución en frío, filtros, enlaces de reserva, 375/1440 px.
- Ninguna fase se cierra con un check en rojo.

## 12. Criterios de aceptación

1. Oportunidades ordenadas sin comparar monedas distintas; cada precio muestra su moneda.
2. Cero monedas hardcodeadas en la UI.
3. Las alertas de `/searches/[id]` son solo de esa búsqueda.
4. Ningún botón promete una acción inexistente.
5. Estados de carga, vacío, error, desactualizado, en ejecución (con explicación del cold start), completada y fallida, todos presentes y sin datos inventados.
6. Sin dependencias nuevas; RLS, migraciones, scraper, scheduler y booking intactos.
7. 1440 / 1024 / 768 / 375 px con teclado, foco visible, etiquetas y `prefers-reduced-motion`.
8. `lint`, `typecheck`, `test`, `build` en verde.
9. Ningún secreto de fuente aparece en el cliente, en logs ni en mensajes de error.

## 13. Limitaciones conocidas

- Sin FX: cambiar la moneda del perfil con datos ya guardados mezcla monedas en el histórico (mismo techo que F9).
- El modelo guarda los precios en columnas `*_eur`: el histórico se muestra en EUR con aviso cuando el perfil use otra moneda.
- `alert_dispatches` no tiene columna de moneda: precio y umbral de alertas se muestran en EUR, que es como se evalúan.
- No hay edición de alertas como feature nueva: la condición se muestra y se edita desde Mis búsquedas.
- **Credenciales de fuentes (fase 9):** el `/api/health` de Ignav **no valida la clave** (responde 200 a cualquier cadena), así que "Probar conexión" usa `/api/airports` y **consume una petición real** de la cuota. SerpAPI no tiene ninguna comprobación posible sin gastar cuota.
- **Clave maestra:** si `SOURCE_SECRET_KEY` se pierde o cambia, las credenciales guardadas quedan **ilegibles** (no hay recuperación: hay que volver a guardarlas). Procedimiento documentado: rotar la clave y guardar de nuevo cada credencial.
- La variable de entorno **siempre gana** sobre la guardada en la aplicación; quitar la fila de la BD revierte al comportamiento anterior.
- Las oportunidades se ordenan por moneda + precio; no existe puntuación de "mejor oferta" (sin definición de producto).
- `gh` requiere autenticación interactiva en esta máquina; sin ella los PR se crean desde la web de GitHub.

## 14. Estado de ejecución (2026-10-10)

**PRs 1–9 mergeados en `master`** (squash, en orden, con CI + preview verdes).
Incluye la fase de credenciales de fuentes cifradas.

### Incidencia resuelta: `app/.env` se subía a Vercel (2026-10-10)

Los despliegues con `vercel --prod` desde este equipo subían `app/.env` al
build: el `.gitignore` de `app/` no lo cubre porque Vercel usa el de la raíz
del repo (Root Directory = `app/`). Consecuencias reales:

- La `SERPAPI_API_KEY` real (y `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ADMIN_EMAIL`) viajaban en cada artefacto de despliegue.
- El allowlist de administrador se saltaba: `ADMIN_EMAIL` del `.env` local
  hacía pasar el guard a cualquier sesión de ese email.

**Arreglo:** `.vercelignore` en la raíz del repo (ignora `.env`, `**/.env`,
`.next`, `node_modules`, `samples/`, `scripts/`, `design-exports/`), más
rotación de `SOURCE_SECRET_KEY` y `ADMIN_EMAIL` a variables de Vercel
cifradas. Verificado: sin `.env`, la sección de credenciales desaparece para
quien no sea el administrador declarado en Vercel.

### Lo que el usuario debe ejecutar (pendiente)

1. En Supabase → SQL Editor, aplicar
   `app/supabase/migrations/20261010000000_source_credentials.sql`.
2. Nada más: `SOURCE_SECRET_KEY` y `ADMIN_EMAIL` ya están en Vercel.

### Lección

Si el CLI de Vercel se usa desde local, `.vercelignore` es la única barrera
fiable para los secretos: el `.gitignore` anidado no se aplica.

| PR | Rama | Contenido |
|---|---|---|
| 1 | `docs/redesign-plan` | Este documento |
| 2 | `fix/data-honesty-p1-p2-p3` | P1/P2/P3 + tests |
| 3 | `feat/design-foundations` | Tokens + 6 componentes UI + nav + foco + reduced-motion |
| 4 | `feat/dashboard-opportunities` | Orden, alertas recientes, hero compacto |
| 5 | `feat/results-filters` | Filtros accesibles en móvil, cabecera honesta, badges |
| 6 | `feat/history-alerts` | Rango min–max, aviso EUR, condición explicada |
| 7 | `feat/searches-forms` | Ejecución por tarjeta + cold start, form de edición completo |
| 8 | `chore/polish` | Foco en ajustes, nota del tema oscuro inerte, nav a 375 px |
| 9 | `feat/source-credentials` | Credenciales cifradas (AES-256-GCM), precedencia env→BD, `/settings`, autorización admin |

La rama 8 corrige que el nav de 5 entradas se cortaba a 375 px (`flex-wrap`).
