# ADR-0013 — Plano editable y la planta del cuarto en el historial

**Estado:** aceptada · **Fecha:** 2026-10-10

## Contexto
El editor era un visor 3D con un panel al lado. Las medidas del cuarto se cambiaban en un diálogo
que guardaba en el servidor y vaciaba el historial: no se podía deshacer ni ver el efecto mientras
se ajustaba. Las apps de referencia (Planner 5D, Floorplanner, RoomSketcher) trabajan con el plano
y el 3D a la vez, con cotas en vivo y guías de alineación.

## Decisión
- **Un solo estado, dos vistas.** El plano (`PlanEditorComponent`, SVG de Angular) y el visor 3D
  leen el mismo `DesignProjectStore` y editan con los mismos comandos. No hay una segunda escena ni
  sincronización: lo que se mueve en una vista se ve en la otra porque es el mismo dato. El editor
  ofrece 3D, plano o los dos lado a lado.
- **La planta es parte de la escena.** `SceneState` incluye el cuarto y `SetRoomCommand` lo cambia
  junto con los muebles, que se reacomodan con él. Mover una pared se deshace con Ctrl+Z como
  cualquier otra edición. Al guardar, la planta viaja con la escena (`UpdateSceneRequest.roomShell`,
  opcional) y el servidor la valida: del cliente solo acepta la geometría.
- **Editar la planta es lógica del dominio.** `room-edit.ts` (en `shared-types`) mueve una pared,
  una esquina o una abertura y devuelve un cuarto válido o un error con su motivo. Las paredes
  conservan su id, así lo colgado y las aberturas las siguen. Como la caja del cuarto vive pegada
  al origen, empujar la pared izquierda corre todo: la operación devuelve ese corrimiento y
  `carryPlacements` lleva los muebles.
- **Cada gesto es un objeto (State).** Al pulsar sobre algo se crea el gesto que corresponde
  (`MoveItemGesture`, `MoveWallGesture`, `MoveVertexGesture`, `MoveOpeningGesture`,
  `MeasureGesture`) y el plano solo le pasa puntos en metros. Los gestos no conocen el DOM: se
  prueban con un proyecto de mentira.
- **Un arrastre, un paso de deshacer.** Los comandos de un mismo gesto comparten una clave y se
  fusionan aunque el usuario se detenga a mitad (`continuous`), en vez de depender de la ventana
  de tiempo que usan los deslizadores.
- **Guías y cotas.** `snapping.ts` alinea bordes y centros con los demás muebles y, si no hay nada
  cerca, cae en una rejilla de 5 cm. El mueble seleccionado muestra su distancia a las cuatro
  paredes.
- **Ediciones compartidas en un servicio.** Añadir, duplicar, copiar, pegar y vaciar se lanzan
  desde el catálogo, el inspector, la lista de objetos, el teclado y al soltar sobre el plano o el
  visor: `SceneEditsService` las reúne para que hagan siempre lo mismo.
- **Exportar sin servidor.** La imagen sale del propio canvas y el plano es un SVG suelto generado
  por una función pura, con colores fijos para imprimir.

## Consecuencias
- Durante un arrastre de pared el cuarto se reconstruye en cada paso de 5 cm; con plantas de pocas
  paredes no se nota.
- El encuadre del plano se congela mientras dura el gesto y el dibujo se compensa con el
  corrimiento del origen; al soltar, el plano se vuelve a encuadrar.
- Lo apoyado sobre otro mueble no se arrastra en el plano (se mueve con su soporte); se sigue
  moviendo en el 3D.
- "Otra distribución" la calcula el servidor y todavía vacía el historial.
- Una respuesta del servidor con una revisión más vieja que la local se descarta: una recarga que
  llega tarde no puede provocar un conflicto de guardado.
