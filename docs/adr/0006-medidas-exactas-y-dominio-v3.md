# ADR-0006 — Medidas exactas del cuarto y dominio v3 (piezas personalizables)

**Estado:** aceptada · **Fecha:** 2026-10-06 · Complementa [ADR-0003](0003-escala-y-calibracion.md)

## Contexto
La calibración de un gesto (ADR-0003) escala todo el cuarto por un único factor, así que las
proporciones estimadas de la foto nunca cambian. Quien tiene un metro quiere escribir ancho, largo y
alto por separado, mover puertas y ventanas, y que cada mueble tenga su propio tamaño, material y
montaje (piso, techo, pared o encima de otro mueble).

## Decisión
- **`PUT /projects/:id/room`** recibe `{revision, widthM, depthM, heightM, openings?}`.
  `resizeRoomShell` (en `shared-types`) reconstruye las paredes; cada abertura conserva su posición
  *relativa* en su pared y se recorta si ya no cabe. Si el usuario envía las aberturas, se validan
  tal cual con `validateOpenings` (sin recortes silenciosos). El resultado queda con `scaleConfidence = 1`.
- **Medidas al crear el proyecto** (opcionales, las tres juntas): se guardan en `Project.requestedRoom`
  y el pipeline las aplica sobre la estimación de la IA, conservando lo detectado (puertas, ventanas).
- **Ningún mueble se borra** al cambiar el cuarto: el servidor los mete dentro moviéndolos lo mínimo;
  `fitPlacementsToRoom` le dice a la UI de antemano cuántos se moverán y cuáles no caben.
- **Dominio v3 compatible hacia atrás:** todo campo nuevo es opcional.
  - `FurniturePlacement`: `dimensionsM`, `materials`, `elevationM`, `wallId`, `supportId`, `origin`.
  - `CatalogItem`: `tags`, `synonyms`, `description`, `source` y el *spec* de personalización
    (`recipe`, `materialSlots`, `resize`, `elevationDefaultM`, `tucksUnder`, `allowsUnder`), que en la
    base de datos vive en una sola columna `spec JSONB`.
  - `Mount` = `floor | ceiling | wall | surface`; 5 categorías nuevas.
  - `RoomFinishes` (piso, paredes, techo) con la biblioteca `materials.ts`.
- **El servidor sigue siendo la defensa en profundidad:** acota `dimensionsM` a los rangos del catálogo
  (±30 % si no hay rangos), descarta referencias inválidas (`supportId` inexistente → el objeto cae al
  piso; `wallId` desconocido), calcula la altura según el montaje y valida los materiales de los acabados.
- **Contrato con la IA:** Pydantic acepta los campos nuevos y FastAPI serializa con
  `response_model_exclude_none` (zod rechaza `null` en un opcional). El motor de reglas v1 no
  autocoloca objetos de pared ni de superficie y respeta el tamaño propio de los muebles fijados.

## Consecuencias
- La misma función pura (`resizeRoomShell`) da la vista previa en el navegador y el resultado
  guardado: el error que ve el usuario es el mismo que devolvería la API.
- Los proyectos guardados antes de v3 se leen sin migrar datos (prueba de compatibilidad en
  `domain-v3.spec.ts`); la migración SQL solo agrega columnas.
- Cambiar el cuarto todavía no se puede deshacer con Ctrl+Z (es una operación del servidor); queda
  registrado en las versiones.
