# ADR-0037: Diseños de vitrina y exportar a Blender (plan v11)

**Estado:** aceptada · **Fecha:** 2026-11-03 · **Amplía:** ADR-0019 (plantillas) y ADR-0036 (Blender)

## Contexto
Las plantillas existentes salían del motor de amueblado automático: correctas, pero sin la mano de
un diseñador. Se quería una vitrina con los mejores diseños posibles (uno por ambiente, cada uno de
un estilo) y que cualquier diseño se pudiera llevar a Blender como un archivo que, al abrirlo, ya se
vea bien, sin tener que configurar luces, cámara ni render.

## Decisión
- **Vitrina compuesta a mano, validada por el dominio.** `e2e/scripts/make-showcase.mjs` describe
  cada cuarto como una receta (piezas en el piso, en una pared, en el techo o encima de otro mueble)
  y la convierte en una escena con las mismas funciones de `shared-types` que usa el editor
  (`positionOnWall`, `mountY`, `DesignToolbox`). Antes de escribir revisa choques entre cuerpos y
  `checkDesign`; si algo falla, termina con error, así que una vitrina con una puerta tapada o un
  mueble fuera del cuarto no se puede publicar. Las seis escenas son plantillas `featured` y van
  primeras en `/plantillas` con la insignia «Destacada». Sus miniaturas son renders de Cycles.
- **Exportar no es renderizar.** `RenderSpec.purpose = 'export'` usa la misma cola y el mismo nodo,
  pero solo renderiza una miniatura de 960 px (48 muestras) para la galería y guarda el `.blend`
  configurado en calidad final (2048 muestras, exposición medida). Tarda unos segundos en vez de
  minutos y gasta la misma cuota.
- **El `.blend` se abre listo.** Colecciones `Cuarto`, `Muebles`, `Luces` y `Cámara`; muebles con el
  nombre del catálogo; texturas empaquetadas; visor en vista de cámara con *Material Preview* y las
  luces y el mundo de la escena (Blender no conserva el modo *Rendered* al reabrir un archivo), EEVEE
  con trazado de rayos para que el visor ya se parezca al render; salida en `//render.png` y un texto
  `LEEME` con los atajos (F12, Z → Rendered, Numpad 0).
- **En la web:** «Exportar → Archivo de Blender» en el editor abre el estudio con Blender elegido; al
  terminar, un aviso ofrece «Descargar .blend» y la galería lo muestra como «Archivo de Blender».

## Consecuencias
- Rehacer la vitrina es un comando (`node e2e/scripts/make-showcase.mjs <api> <salida>`); si cambia
  el catálogo y una receta deja de cumplir, el script lo dice en vez de publicar algo roto.
- Una pieza con un GLB roto (la lámpara industrial de 3 KB) se ve como una caja en Blender: la
  vitrina usa piezas paramétricas o con modelo verificado.
- Exportar necesita el nodo Blender encendido, igual que renderizar (ADR-0036); en el modo demo no
  se ofrece.
