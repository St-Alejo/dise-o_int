# ADR-0010 — Cuartos de forma libre: planta poligonal y compatibilidad

**Estado:** aceptada · **Fecha:** 2026-10-10

## Contexto
Todas las habitaciones salían iguales porque el cuarto era siempre una caja de cuatro paredes: lo
asumían el analizador de fotos, la colisión, los montajes, el chat, el diálogo de medidas, el motor
de distribución y el render. Las apps de referencia (Planner 5D, Floorplanner, Arcadium) obtienen
cuartos distintos con un modelo paramétrico de la planta —polígono, altura y aberturas por pared—
que el usuario confirma. Había que llegar ahí sin romper los proyectos ya guardados.

## Decisión
- **La planta es `RoomShell.walls`**, que ya admitía de 3 a 64 tramos. No hay campos nuevos
  obligatorios: `widthM` y `depthM` pasan a ser la caja que envuelve al cuarto y se añade `shape`
  (`rect`, `L`, `T`, `U`, `free`) como opcional. Un proyecto anterior valida y abre igual.
- **Camino rápido rectangular.** `isBoxRoom` detecta el cuarto de siempre y `isInsideRoom`,
  `clampToRoom` y `resizeRoomShell` ejecutan para él el código anterior. Solo los cuartos de forma
  libre pasan por la geometría de polígonos (`polygon.ts`).
- **Normales por orientación.** La normal interior de cada pared sale del sentido de giro de la
  planta. La regla anterior ("hacia el centro de la caja") falla en una L o una U, donde ese centro
  puede caer fuera del cuarto.
- **`WallFrame` general.** Los marcos de pared salen de las paredes reales (`base`, `dir`,
  `normal`, `length`). `along` crece siempre hacia +x o +z, así en un rectángulo sigue siendo la
  coordenada del cuarto y el comportamiento existente no cambia.
- **Ids estables.** En cada lado de la caja, la pared más larga conserva su id histórico
  (`w-back`, `w-right`, `w-front`, `w-left`); las demás se numeran. "La pared del fondo" significa
  lo mismo en un cuarto en L: las paletas de estilo, el chat y las pruebas no se tocan.
- **`RoomPlan` (objeto de valor)** concentra el comportamiento del dominio: área, perímetro,
  esquinas salientes y entrantes, dónde cabe una pieza, qué pared mira hacia cada lado y cómo
  cambia de medidas. `RoomShell` sigue siendo el formato que viaja y se guarda.
- **Plantillas de forma** (`RoomShapeTemplate` + registro `ROOM_TEMPLATES`): rectángulo, L, T y U a
  partir de las medidas totales y de su muesca.
- **Render.** Piso y techo con `THREE.Shape`. El techo mira hacia abajo: en la vista de órbita el
  descarte de caras traseras lo oculta solo y desde dentro se ve. Las paredes se alargan su
  espesor solo en las esquinas salientes; en una entrante ese alargue invadía el cuarto.
- **Dos implementaciones, los mismos casos.** La geometría existe en TypeScript y en Python (motor
  de distribución). `packages/shared-types/fixtures/polygon-cases.json` tiene casos calculados a
  mano que corren Vitest y pytest: si divergen, falla una de las dos suites.

## Consecuencias
- Acotar una pieza en un cuarto cóncavo es más caro que en un rectángulo (empuje iterativo y, si no
  basta, búsqueda en anillos). Solo lo pagan los cuartos de forma libre.
- `interiorAnchor` aproxima con una rejilla de 40 × 40 el punto más despejado: suficiente para
  colocar muebles, no es exacto.
- El motor de distribución sigue penalizando muebles altos en `w-front` ("la pared de la cámara");
  en un cuarto sin esa pared la regla simplemente no aplica.
- Cambiar las medidas de un cuarto de forma libre estira la planta por eje: conserva la forma, no
  los ángulos de paredes inclinadas.
- Quedan fuera: varias habitaciones por proyecto, alturas distintas por zona y paredes curvas.
