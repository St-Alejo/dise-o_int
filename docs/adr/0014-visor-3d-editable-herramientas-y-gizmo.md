# ADR-0014 — Visor 3D editable: herramientas, gizmo y multiselección

**Estado:** aceptada · **Fecha:** 2026-10-10

## Contexto
El plano ya era editable (ADR-0013), pero en el visor 3D solo se podía arrastrar un mueble: para
girarlo libremente, cambiar su tamaño, mover una pared o pintarla había que ir al plano, al
inspector o a un diálogo. El pedido fue que donde se ve el 3D se pueda editar todo.

## Decisión
- **Herramientas del visor (State).** `ViewportTool` tiene cuatro estados: `SelectTool`,
  `RoomTool`, `PaintTool` y `MeasureTool`. `ToolManager` guarda la activa y le entrega cada gesto;
  `SceneService` ya no decide qué significa un clic. Añadir una herramienta es añadir una clase.
- **Las herramientas no conocen three.js.** Reciben un rayo (origen y dirección) y hablan con la
  escena por interfaces pequeñas (`SelectHost`, `RoomToolHost`…). Se prueban con rayos sintéticos.
- **Se reutilizan los gestos del plano.** `RoomTool` crea los mismos `MoveWallGesture` y
  `MoveOpeningGesture`: solo cambia cómo se obtiene el punto (un rayo contra la pared en vez de
  una coordenada del SVG). Una regla de negocio, dos formas de apuntar.
- **Gizmo en tres piezas.** `gizmo-math.ts` (pura) dice dónde va cada tirador y traduce un rayo a
  un giro o a una medida; `GizmoView` solo dibuja y dice qué tirador hay bajo el cursor;
  `GizmoController` convierte el arrastre en comandos.
- **Girar se previsualiza; estirar se aplica en vivo.** El giro mueve los objetos de la escena sin
  tocar el estado y deja un comando al soltar. Estirar reconstruye la pieza, así que aplica cada
  paso desde el estado inicial con `SetPlacementsCommand`, cuyos comandos de un mismo gesto se
  fusionan: sigue siendo un solo paso de deshacer.
- **Un solo comando de redimensionar.** `buildResize` lo comparten el inspector (que reubica la
  pieza si no cabe) y el gizmo (que no la deja saltar de sitio mientras se arrastra).
- **Lo que se ve sobre la escena son dos capas.** `GuidesView` dibuja líneas (guías de alineación,
  cotas, regla, contornos); `OverlayLabels` pega textos y controles HTML a puntos de la escena y
  los recoloca al dibujar cada frame, fuera de la detección de cambios de Angular.
- **Multiselección sin romper lo que había.** La pieza principal sigue en `selectedId`; las demás
  van en `extraIds`. Lo que trabaja con una pieza (inspector, gizmo) no cambió; las acciones de
  grupo viven en `SceneEditsService` y `arrange.ts` (alinear y repartir, lógica pura).
- **Texturas generadas, no descargadas.** El piso lleva una textura dibujada en un canvas con
  semilla (listones, baldosas, vetas) que multiplica el color del material. La CSP no permite CDN
  y así no se añaden megas de imágenes ni un paso de descarga al despliegue.

## Consecuencias
- Las paredes que el visor vuelve translúcidas (las que quedan de espaldas a la cámara) no se
  pueden agarrar: hay que girar la cámara o usar el plano.
- Los tiradores se escalan con la distancia para verse siempre del mismo tamaño; en pantallas
  táctiles siguen siendo pequeños.
- El alto del cuarto se cambia con un campo numérico, no con un tirador en la escena.
- Queda fuera el posprocesado (contorno de selección y oclusión ambiental): su costo en equipos
  modestos no compensaba todavía.
- `window.__scene` expone la herramienta activa y la posición en pantalla de los tiradores para
  que las pruebas de extremo a extremo arrastren los de verdad.
