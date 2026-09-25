# F5 Alerts Audit — engine de evaluación + dispatch (2026-09-25)

Resultado: **VERDE** — alerta se dispara y se registra dispatch, no duplica en ventana de cooldown.

## Cómo funciona

- Config por búsqueda: `searches.alert_threshold_eur` (UI crear/editar). Single source of truth.
- `alerts_edge` (provider `telegram`, cooldown 24h, `last_fired_at`) se materializa desde el threshold al disparar por primera vez.
- `alert_dispatches` registra cada disparo (status `dispatched`; el envío real a Telegram es F6).
- Engine puro testable sin red: `src/domain/alerts/evaluate-alert.ts` (`evaluateAlert`) — decide fire/no-fire según threshold, mejor precio y ventana de cooldown (`elapsedHours < cooldownHours` bloquea).
- Hook en `POST /api/searches/[id]` → `evaluateAndDispatchAlerts()` tras ejecución completada. El engine nunca hace fallar la ejecución (try/catch aislado).

## Tests

`src/domain/alerts/evaluate-alert.test.ts` — 7 casos: dispara bajo/igual threshold, no sin threshold, no sin opciones, no por encima, respeta cooldown, re-dispara tras vencerlo.

## E2E (Supabase local + navegador)

| Paso | Resultado |
|---|---|
| Ejecutar MAD→BCN con `alert_threshold_eur=80` (seed) | mejor opción 60.00 ≤ 80 → 1 `alert_dispatches` (60.00, `dispatched`) + `alerts_edge` creado, `last_fired_at` set |
| 2ª ejecución inmediata (mismo threshold) | cooldown 24h → sin nuevo dispatch, `last_fired_at` intacto |
| Editar threshold → 50 | persistido en `searches.alert_threshold_eur = 50` |
| Ejecución con threshold 50 | 60.00 > 50 → sin dispatch, edge intacto |

## Notas

- Base UI avisa por `defaultValue` en un FieldControl (warning existente, no bloqueante).
- El cooldown se limita al borde exacto: `elapsedHours < cooldownHours` bloquea; exactamente el límite dispara (semántica documentada en test).