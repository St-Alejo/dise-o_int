# ADR-0023 — Brief de diseño, acabados propios y zonas interiores (dominio del plan v7)

**Estado:** aceptada · **Fecha:** 2026-10-21

## Contexto
El plan v7 pide cuatro cosas que el dominio no sabía representar:

- Un botón **Recomendar** que vaya cambiando el cuarto pero **respete lo que la persona ya eligió**.
  Por ejemplo, "quiero piso de baldosa brillante azul claro con verde" no cambia al volver a recomendar.
- Acabados que **no existen en la biblioteca**: esa baldosa no es ninguno de los diez pisos.
- Un **baño privado dentro de la habitación**, con tabiques y puerta, y con su propia baldosa. Hoy
  un cuarto es un solo polígono.
- Una luz del cuarto (cálida, fría; tenue, alta) que se guarde con el diseño.

## Decisión
- **Acabados propios por id.** `RoomFinishes.custom` es un diccionario `custom-… → FinishSpec`. Un
  `FinishSpec` describe el acabado con su familia, uno a tres colores, dibujo, tamaño de pieza,
  brillo y color de junta. Piso, paredes y techo siguen guardando **solo ids**, así casi todo el
  código existente no cambia. `resolveFinishMaterial()` devuelve el material de la biblioteca o
  lo construye a partir del `FinishSpec`. `customFinishId()` es estable: el mismo pedido da el mismo
  id y no se duplica.
- **Más acabados en el mismo objeto:** `wallTiles` (revestimiento desde el piso hasta una altura),
  `zones` (acabados por zona) y `lighting` (`mood` + `level`). Van en `RoomFinishes` y no en
  columnas nuevas. Así viajan solos por todo lo que ya transporta acabados: versiones, duplicar,
  importar, el chat y el deshacer (`SetFinishesCommand`).
- **Zonas en la planta.** `RoomShell.zones` lista hasta 4 zonas. Cada una tiene un contorno dentro
  del cuarto, `open` y una puerta opcional. Los tabiques **no se guardan**: son los lados del
  contorno que no caen sobre una pared (`zoneEdges`). Así no pueden quedar desalineados con su zona.
  `validateZones` exige que la zona esté dentro del cuarto, que sea simple, que mida al menos
  1.2 m², que no se encime con otra y que su puerta quepa en un tabique.
  `validateRoomShell` la llama, así que la API la aplica en cada guardado.
- **Brief aparte.** `projects.brief` es una columna JSON nueva y `PUT /projects/:id/brief` la
  guarda. Allí van el estilo, los acabados fijados (material o `FinishSpec`), la paleta, la luz, las
  piezas que deben estar (`mustHave`), las que no (`avoid`) y las zonas pedidas con su preset.
  El brief es una preferencia de quien diseña, no parte de la escena: no cambia la revisión, como
  el tope de presupuesto. Lo fijado nace `locked: true`.
- El contrato con el servicio de IA acepta `zones` en `RoomShell` (Pydantic con `extra="forbid"`).
  El test de contrato lo comprueba con un baño privado.

## Consecuencias
- Los proyectos guardados siguen siendo válidos: todo lo nuevo es opcional.
- La web resuelve ya los ids propios al pintar. Las texturas por patrón y los tabiques en 3D
  llegan en las fases 1 y 3.
- Editar paredes con una zona dentro puede dejarla fuera del cuarto. Hoy eso se rechaza al
  guardar. Moverla junto con la pared queda para la fase 3.
- Se pospone la tabla `RecommendationFeedback` del plan hasta que exista quien la escriba (fase 4).
