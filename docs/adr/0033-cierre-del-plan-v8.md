# ADR-0033: Cierre del plan v8 (Modo Pro)

**Estado:** aceptada · **Fecha:** 2026-11-01 · Cierra los ADR-0028 a 0032

## Contexto
El plan v8 llevó la app de "diseño mi cuarto" a "le entrego a un constructor lo que diseñé": planos
técnicos, normativa, cómputo y presupuesto de obra e instalaciones, todo detrás de un Modo Pro que
quien no lo activa no ve. La fase 5 junta esas piezas con el chat y las plantillas.

## Decisiones
- **El chat responde lo técnico sin tocar la escena.** El modelo local de intención gana
  `pro_quantities`, `pro_compliance`, `pro_drawings` y `pro_installations` (dataset con plantillas,
  contrato zod ↔ Pydantic regenerado). La `DesignToolbox` expone cuatro herramientas de solo lectura
  (`estimate_works`, `check_compliance`, `suggest_installations`, `list_drawings`) que llaman a las
  mismas funciones de `pro/` que la pestaña Pro; Groq y Claude también las ven. Lo que cambia la ficha
  técnica (guardar instalaciones, trazar un corte) sigue siendo un clic en la pestaña Pro, donde se
  ve y se deshace: el chat explica dónde hacerlo.
- **Plantilla profesional.** "Dormitorio listo para obra" es la escena del dormitorio luminoso con
  una ficha técnica (cajetín, perfil Colombia, instalaciones propuestas por la app). La genera
  `e2e/scripts/make-pro-template.mjs` y al guardarla en la cuenta la ficha viaja con
  `POST /projects/import` (`technical` opcional).
- **Una sola fuente de verdad.** Ninguna regla, cantidad o símbolo se calcula dos veces: la web, la
  API (PDF/DXF/CSV) y el chat importan las mismas funciones puras.

## Consecuencias
- El Modo Pro no se puede probar sin cuenta: la demo avisa de que hay que guardarla y activarlo.
- Desviaciones y pendientes, anotados en `tasks/todo.md` (sección "Plan v8").
