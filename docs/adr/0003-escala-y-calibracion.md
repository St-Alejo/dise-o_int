# ADR-0003 — Escala: estimación marcada como aproximada + calibración de un gesto

**Estado:** aceptada · **Fecha:** 2026-09-29

## Decisión
El análisis devuelve `scaleConfidence` (0.3 mock / 0.5 profundidad) y `needsCalibration=true`.
El editor muestra el aviso y un diálogo para confirmar **una** medida conocida (puerta, techo,
ancho o profundidad). `calibrateRoomShell` (en `shared-types`) reescala cuarto y posiciones y se
usa en el cliente (vista previa) y en el servidor (fuente de verdad). Factores fuera de 0.25–4 se
rechazan como error de entrada.

## Consecuencias
Una sola función pura para ambos lados: la vista previa nunca difiere del resultado guardado.
