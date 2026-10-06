# ADR-0002 — IA intercambiable (Strategy): mock sin GPU por defecto, Replicate opcional

**Estado:** aceptada · **Fecha:** 2026-09-29

## Contexto
Difusión y profundidad monocular necesitan GPU o una API de pago. El proyecto debe correr en
cualquier laptop, en CI y en una nube barata.

## Decisión
Cada capacidad es un puerto con dos implementaciones seleccionadas por entorno:
`ROOM_ANALYZER` / `STYLE_GENERATOR` = `mock` (OpenCV + gradación de color, determinista) o
`replicate` (Depth-Anything-V2, ControlNet de interiores). Sin token, `replicate` degrada a
`mock` con un aviso. El motor de layout (Track B) es real desde el día uno: reglas + minimización
greedy de costo, detrás de la interfaz `LayoutEngine` (lista para ATISS, §6.2 v2).

## Consecuencias
- (+) Demo y CI sin costos; la UI marca las previews mock como "vista previa simulada" (honestidad).
- (+) El adapter de Replicate tiene timeout, polling con backoff, cancelación y circuit breaker.
- (−) La calidad del Track A en modo mock es limitada por diseño.
