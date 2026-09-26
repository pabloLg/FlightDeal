# Auditoría F9 — Flexible search (2026-09-26)

Alcance aprobado por el usuario: **moneda por perfil + tendencias globales + rangos
flexibles (`date_flex_days`)**. Fuera de alcance: multidestino y geografía (`hl/gl`),
D4 congelada en MVP.

## Cambios

### Schema
- `supabase/migrations/20260925200000_f9_flexible_search.sql`: `searches.date_flex_days
  int not null default 0 check (0..21)`. Sin cambio de schema para moneda
  (`profiles.currency` ya existía) ni para tendencias (`price_stats_daily` ya existía,
  trigger de F4 lo mantiene).
- `supabase/seed.sql`: segunda búsqueda demo `MAD → LHR` con `date_flex_days = 5`
  (`00000000-...-000a`) para poder verificar la ventana sin configurarla a mano.

### Dominio
- `FlightSearchParams.flexDays?: number` (`src/domain/sources/types.ts`). La flexibilidad
  viaja por la **misma interfaz de fuente**, criterio de aceptación del plan.
- `MockFlightSource`: con `flexDays = n` genera `2n+1` opciones (una por día de la
  ventana `-n..+n`, desplazando `departDate` y `returnDate` con `addDays` UTC). Sin
  `flexDays` mantiene las 3 opciones de siempre. Determinista: los ids llevan la fecha
  real de cada día, así que repetidas ejecuciones upsert sobre `dedupe_key` y no
  duplican.
- `toSearchParams` mapea `date_flex_days` → `flexDays` (`0` se pasa como `undefined`).
- `SearchRow` incluye `date_flex_days`.

### API / acciones
- `readForm` (`app/actions/search.ts`) parsea `date_flex_days` (vacío → 0). El check de
  la base acota a 21.
- `app/actions/profile.ts`: `updateProfileCurrency` valida `/^[A-Z]{3}$/`, actualiza
  `profiles.currency` (RLS `profiles_owner_update` ya lo permite) y revalida dashboard.
- Runner, scheduler y alertas sin tocar: la moneda y el flex entran por los parámetros
  existentes, no hizo falta tocar `runExecution`.

### UI
- `searches-view.tsx`: campo "Flexibilidad (± días)" (0–21) en crear y editar; el card
  muestra "±N días flexibles" cuando aplica.
- `components/profile/currency-form.tsx`: selector de moneda (EUR por defecto) en el
  dashboard.
- `app/dashboard/page.tsx`: tarjeta "Preferencias" (moneda) y "Tendencias (últimos 7
  días)" — mínimo de `price_stats_daily` por búsqueda en la ventana, ordenado de menor
  a mayor. RLS `price_stats_daily_owner_select` ya lo restringe a las búsquedas propias.
- `app/searches/[id]/page.tsx`: `PriceHistory` y `AlertHistory` reciben la moneda del
  perfil en vez de hardcodear "EUR" (el histórico mostraba EUR con datos en USD tras
  cambiar la moneda).

## Verificación

- Unit (33/33): nuevo caso "spans the flex window" — `flexDays: 2` → 5 opciones con
  fechas `2026-12-08..12` y determinismo entre llamadas.
- `typecheck`, `lint`, `build` verdes.
- `supabase db reset` aplica la migración y el seed sin errores.
- E2E (demo@example.com / DemoPass123!):
  - Moneda EUR → USD → EUR: la tarjeta de tendencias pasa de "desde 60.00 EUR" a
    "desde 60.00 USD" y el histórico de `/searches/[id]` muestra "162.00 – 201.00 USD".
  - Ejecución de `MAD → LHR` (flex 5): 11 opciones, una por día de la ventana;
    tendencia "desde 162.00 EUR".
  - Crear `MAD → CDG` con flex 2 desde el formulario: aparece "±2 días flexibles",
    ejecutada da 5 opciones y su propia tendencia.
  - Consulta SQL confirma: `BCN flex 0 → 2 opciones` (seed), `CDG flex 2 → 5`,
    `LHR flex 5 → 11`. Búsqueda de prueba CDG eliminada tras verificar.

## Notas / ceilings

- La moneda se aplica al dato **tal como lo devuelve la fuente** (D8: conversión FX
  opcional vía Frankfurter, fuera de MVP). Con un perfil en USD, las filas históricas
  acumuladas en EUR siguen etiquetándose con la moneda actual del perfil: mezcla de
  monedas solo posible si se cambia de moneda con datos ya guardados. Cuando entre el
  conversor, los agregados `*_eur` de `price_stats_daily` deberán migrar a moneda canónica.
- `alert_threshold_eur` conserva el nombre histórico aunque el umbral se compare en la
  moneda del perfil; renombrar columnas está fuera de MVP.
- Multidestino y geografía por perfil siguen pendientes (fuera del alcance aprobado).
