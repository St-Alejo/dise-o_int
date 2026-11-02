# ADR-0035: Trazado de rayos en el navegador con respaldo raster (plan v9, fase 1)

**Estado:** aceptada · **Fecha:** 2026-11-02

## Contexto
El estudio de render (ADR-0034) dibuja en el navegador. Para que la imagen parezca una foto hacen
falta luz rebotada, sombras suaves, reflejos y cristal de verdad, cosas que el visor WebGL solo
imita (GTAO, sombras de contacto, penumbras pintadas). Las opciones eran escribir un trazador
propio, usar el `WebGPURenderer` de three o usar `three-gpu-pathtracer`, que trabaja sobre la misma
escena de three.js.

## Decisión
- **`three-gpu-pathtracer@0.0.24`** (con `three-mesh-bvh`) en un chunk aparte, que solo se descarga
  al pulsar «Renderizar». Las versiones 0.0.25 y siguientes piden three ≥ 0.185 y el repo está en
  0.183.
- **Patrón Strategy**: `RenderEngine` (`prepare`, `step`, `finish`, `snapshot`, `healthy?`,
  `dispose`) con dos motores. `PathTracerEngine` suma una muestra por píxel en cada pasada y aplica
  el `DenoiseMaterial` al final. `RasterEngine` toma la mejor calidad del visor (AO, sombras de
  4096, sombras de lámparas), desplaza cada cuadro una fracción de píxel con la secuencia de Halton
  y promedia. `RenderStudioService` no sabe cuál usa: acumula muestras en `requestAnimationFrame`
  con un presupuesto de 40 ms por cuadro (la página sigue respondiendo), refresca la vista previa
  unas tres veces por segundo, permite cancelar y siempre deja el visor como estaba.
- **Escena fotográfica sin tocar el visor**: `SceneService.beginStudio(view)` guarda la cámara y
  devuelve la función que lo deshace. Mientras dura, oculta las ayudas, las sombras de contacto, las
  penumbras pintadas y las paredes cortadas (en el visor solo dejan de pintarse, pero el trazador
  las vería igual). También pone la cámara física con el descentramiento de
  `twoPointPerspective`, y `LightingRig.photographic()` cambia las luces de relleno por un cielo
  HDR por hora del día (`PHOTO_SKY_RADIANCE`), que entra por las ventanas.
- **La imagen se lee con `readPixels`** en el mismo instante en que se dibuja (`readScreen`):
  `drawImage` de un lienzo WebGL sin `preserveDrawingBuffer` devuelve la imagen vacía en Chrome con
  D3D11.
- **Dos parches sobre la librería**, cada uno en su módulo y con prueba:
  - `split-meshes.ts`: la librería da un único índice de material a cada malla, así que una malla
    con varios materiales (paredes, zócalos, algunos GLB) desplaza los de todas las demás, y el
    orden cambia en cada render porque se ordena por uuid. Antes de `setScene`, esas mallas se
    parten en mallas de un solo material que comparten atributos, y después se deshace.
  - **Comprobación de salud**: en algunas combinaciones de GPU y backend (Intel Arc con ANGLE
    D3D11) el trazador compila pero acumula negro. Tras dos pasadas se leen cinco bloques del
    acumulado (`healthy()` con `hasSignal`). Si todo es cero o hay NaN, se lanza
    `EngineUnsupportedError` y el estudio repite el render en raster, con un aviso visible. Con
    Vulkan (NVIDIA RTX) traza bien: un 1080p borrador sale en unos 27 s.
- Sin WebGL2 con `EXT_color_buffer_float`, el estudio usa raster directamente.

## Consecuencias
- Render realista sin servidor ni costo por imagen. La primera vez, compilar el sombreador del
  trazador bloquea la página entre 20 y 60 s según la GPU, y el estado lo avisa.
- El respaldo hace que el botón nunca termine en una imagen negra; la imagen raster es menos
  realista, pero correcta.
- Al subir three a ≥ 0.185 conviene actualizar la librería y comprobar si los dos parches siguen
  haciendo falta (el de mallas con varios materiales es un fallo de la propia librería).
- Pendiente para fases siguientes: HDRI reales por hora y vidrio físico en las ventanas (hoy, cielo
  degradado), y la foto IA sobre el render (fase 2).
