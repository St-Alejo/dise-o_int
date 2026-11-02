# ADR-0034: Estudio de render: se dibuja en el navegador, la IA va en el servidor (plan v9)

**Estado:** aceptada · **Fecha:** 2026-11-02

## Contexto
La gente quiere ver su diseño "como una foto", al estilo de las apps de IA que rediseñan un cuarto
a partir de una imagen. La app ya exportaba un PNG del visor (`frameCapture`), pero con el aspecto
de un visor WebGL. El plan v9 añade un estudio de render (trazado de rayos o raster de alta
calidad), una foto realista hecha por IA a partir del render, vídeos de recorrido y una galería por
proyecto. Había que decidir dónde se renderiza y cómo se guarda.

## Decisión
- **El render 3D se hace en el navegador**, con la misma escena del visor y la GPU de quien lo pide.
  Renderizar en el servidor obligaría a tener GPU en Railway o a reconstruir la escena con otro
  motor (Blender), lo que duplica materiales y luces, cuesta dinero en cada render y añade colas
  largas. En el cliente es gratis, la vista previa es en vivo y lo que se ve es lo que sale.
- **La foto realista la hace la IA en el servidor** (Replicate, detrás del puerto de proveedores
  del servicio de IA), porque necesita un modelo de difusión con GPU y una clave que no puede
  viajar al navegador. Se encola en `ai-jobs` como el resto de trabajos de IA y consume la cuota
  diaria.
- **Dominio puro en `shared-types/src/render/`**: `RenderSpec` (cámara física con focal en mm,
  hora, resolución, formato, calidad y motor), `renderSize`, `verticalFovDeg`, `topDownCamera` y
  `twoPointPerspective`. Esta última nivela la cámara y descentra el objetivo, como un objetivo
  basculable de fotografía de arquitectura, para que las paredes no "caigan".
- **Galería como agregado aparte**: tabla `renders`, puerto `IRenderRepository` con su adaptador
  Prisma y su doble en memoria, y módulo Nest `renders` (`/projects/:id/renders`). No se mete en
  `IProjectRepository`, que ya era grande: un render solo depende de que el proyecto exista y sea
  de quien lo pide (`ProjectAccess`).
- **Subidas desconfiadas**: el tipo se decide por magic bytes (PNG/JPEG para el estudio, MP4/WebM
  para el recorrido), con tope por archivo (`RENDERS_MAX_MB`) y por proyecto
  (`RENDERS_PER_PROJECT`). Los archivos van a `projects/{id}/renders/{rid}.{ext}`, se sirven con
  URL firmada y se borran en cascada con el proyecto y con la retención.

## Consecuencias
- Un render final en 4K depende de la GPU del usuario: el estudio enseña el progreso, deja cancelar
  y tiene un modo raster de respaldo.
- La foto IA puede cambiar detalles de los muebles. Por eso se guía con el mapa de profundidad del
  render y la interfaz avisa de que es una imagen generada.
- Una tabla y un módulo nuevos. La migración es aditiva.
