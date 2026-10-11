# Plan v6 — Interiores IA: landing editorial, 3D más real, app más robusta y funciones nuevas

Proyecto: `diseño de interiores/` (repo `St-Alejo/dise-o_int`, rama `main`). Rutas relativas a esa carpeta.
Sustituye al plan v5 (3D editable, gestión de proyectos, rediseño de color y tipografía: ya hechos).

## Contexto

La landing se rehízo hace poco (paleta petróleo y arcilla, Fraunces + Inter, diez secciones) y aun así
se ve fea. Revisé las capturas actuales y la causa no es solo la maquetación:

1. **Las imágenes son el problema principal.** Todo lo que enseña la landing son renders de la app, y
   esos renders son pobres: cuartos casi vacíos (la cocina es una mesa sola), paredes de azul y granate
   saturados, paredes cercanas semitransparentes, luz plana sin oclusión ni contorno, nada de
   decoración. Ninguna maquetación arregla eso: **la landing no puede ser elegante hasta que el 3D lo sea.**
2. **La página es una pila de tarjetas.** Diez secciones del mismo peso, tres fondos tintados que se
   alternan, bordes en todo, la imagen del encabezado es pequeña, una tabla comparativa y una franja de
   cifras modestas (147 muebles) que restan en vez de sumar.

Decisiones del usuario para este plan: dirección **editorial cálida**; imágenes = **renders propios
mejorados + unas pocas fotos libres** autoalojadas; funciones nuevas: **varios cuartos por proyecto**,
**muebles y decoración más ricos**, **demo sin registro + plantillas**, **exportar y presentar**.

### Qué enseñan las páginas de referencia

| Página | Qué hace bien | Qué tomamos |
|---|---|---|
| Archime (caso de estudio) | "Show the feeling, then explain": un cuarto cálido antes que cualquier lista; una idea por sección; huye del look IA (oscuro, neón) | Orden emoción → explicación; tono cálido |
| Havenly | Fotografía a sangre, pestañas de estilo con foto del cuarto + productos con precio, copy cercano | Sección de estilos con imagen grande y piezas con precio |
| Rayon | Titulares grandes con una frase en cursiva, texto e imagen alternados, capturas reales del producto | Tratamiento tipográfico; capturas del editor grandes |
| Planner 5D / Floorplanner | "Try DEMO" sin cuenta junto al CTA; galería de diseños hechos | Botón "Probar sin cuenta"; galería de plantillas |
| Interior AI / Spacely | El par antes/después es lo que convence | Deslizador foto ↔ cuarto 3D |
| Arcadium | Enlaces a proyectos de ejemplo abiertos | Plantillas que abren el editor |
| Tendencias 2026 (line25) | Tipografía fluida muy grande (`clamp`), animación por scroll solo con `transform`/`opacity`, < 500 kB | Escala fluida, `animation-timeline: view()` con `@supports` |

Se mantienen: Angular 22 + three.js a mano (lo nuevo sale de `three/examples/jsm`), toda edición es un
comando deshacible, la lógica pura vive en `packages/shared-types`, campos nuevos opcionales, CSP sin
orígenes externos, reglas de git del `CLAUDE.md` (Conventional Commits en español, autor Steven, sin
atribución, commit + push por unidad con pruebas en verde).

## Orden

```
A  3D más real (imagen)            ← base de todo lo visual
B  Cuartos menos vacíos (decoración y distribución)
C  Demo sin registro y plantillas  ← el CTA secundario de la landing
D  Landing editorial               ← usa A, B y C
E  Robustez (web, API, IA, CI)
F  Exportar y presentar
G  Varios cuartos por proyecto     ← el cambio más grande, al final y por etapas
H  Documentación, despliegue y verificación en producción
```

Cada bloque termina con pruebas, commits y push. Al empezar la ejecución, este plan se vuelca a
`tasks/plan.md` y `tasks/todo.md` con tareas S/M y criterios de aceptación (convención del repo).

---

## A — 3D más real

Estado (inventario del código): renderer con ACES, sombras PCF del sol, `RoomEnvironment`, sombras de
contacto y penumbra de rincones; texturas **solo de piso y dibujadas en canvas**
(`scene/texture-library.ts`). **Faltan**: posprocesado, calidad adaptativa, texturas PBR, cámara
ortográfica y `webglcontextrestored` (hoy se recarga la página). La luz de relleno es un punto en el
centro y las paredes cercanas se vuelven translúcidas.

- **A1 Posprocesado** — nuevo `viewport-3d/scene/post-fx.ts`, cargado con `import()`:
  `EffectComposer` (destino con MSAA) + `RenderPass` + `GTAOPass` (oclusión en esquinas y bajo
  muebles) + `OutlinePass` (selección y hover, sustituye el resaltado actual de `selection-view.ts`) +
  `OutputPass`. `scene/render-loop.ts` sigue pintando bajo demanda; solo cambia quién pinta.
- **A2 Luz** — en `scene/lighting-rig.ts`: una `RectAreaLight` por ventana (luz de cielo que entra,
  suave) en lugar de depender de la luz puntual del techo; sombras `PCFSoftShadowMap`; entorno
  capturado del propio cuarto (`CubeCamera` → PMREM, se rehace al cambiar acabados) para que los
  reflejos tengan los colores reales; tercer preset **`tarde`** (sol bajo y cálido) junto a día y noche.
- **A3 Paredes en corte** — en `scene/room-view.ts` y `room-builder.ts`: las paredes que tapan la
  cámara dejan de hacerse translúcidas (opacidad 0,2) y pasan a verse **cortadas a 12 cm con tapa**
  (vista de maqueta, como Planner 5D y Floorplanner). La decisión de qué pared se corta es una función
  pura con spec.
- **A4 Materiales y detalle** — 8–10 materiales PBR CC0 a 1k (madera, baldosa, hormigón, tela, yeso)
  autoalojados en `apps/web/public/textures/` con `ATTRIBUTION.md`; `texture-library.ts` pasa a
  cargarlos de forma perezosa (Flyweight) y deja el canvas como respaldo; `materials.ts` gana
  `textureId?` y `tileM?` (opcionales). Cantos redondeados en los muebles paramétricos
  (`parametric-renderer.ts`, `RoundedBoxGeometry`), vidrio y marco de ventana, hoja de puerta, zócalo.
  Paletas de pared por estilo desaturadas en `shared-types/src/styles.ts` (adiós azul y granate planos).
- **A5 Calidad adaptativa y recuperación** — nuevo `scene/quality.ts` (alta / media / baja: resolución,
  tamaño de sombra, AO sí/no; baja sola si el tiempo de cuadro sube; preferencia en `localStorage`).
  `webglcontextrestored` reconstruye la escena sin recargar (hoy solo se escucha `webglcontextlost`).
- **A6 Cámara y captura** — `camera/top-mode.ts` (cenital ortográfica) como tercer modo de
  `CameraDirector` (las vistas rápidas y F ya existen en `scene.service.ts`);
  `SceneService.capturePng` acepta una escala para imagen en alta resolución pasando por el composer.
- **A7 Restos del visor editable** — botón "cambiar" en la barra contextual, pintar el techo
  (`PaintSurface` solo admite piso y pared) y paleta de materiales al hacer clic en un mueble con la
  herramienta de pintar.

Pruebas: specs puras (corte de paredes, escalones de calidad, presets); `window.__scene` expone
`postFx`, `quality` y `timeOfDay` para e2e; capturas revisadas a ojo en claro/oscuro y en las tres horas.

## B — Cuartos menos vacíos

- **B1 Catálogo de decoración** — piezas nuevas en la semilla del catálogo: cuadros, espejos, plantas,
  cortinas, alfombras, lámparas de pie y de mesa, cojines, libros; variantes de color por ranura de
  material. Paramétricas o CC0, con su licencia en el registro.
- **B2 Segunda pasada de decoración** — en `services/ai/src/interiores_ai/layout/rules_engine.py`
  (hoy "solo piso/techo", línea 374; ya maneja `wall_id` y anclas `next-to`): cuadro centrado sobre sofá o cama, espejo en pared libre,
  lámpara sobre la mesita (`supportId`), alfombra bajo el grupo de asientos, cortina en cada ventana,
  planta en esquina libre. Densidad mínima según el área. Kits completos para cocina y baño.
- **B3 Puntuación** — nuevo `layout/scoring.py` (solapes, pasillo de 70 cm, acceso a aberturas,
  equilibrio): con la misma entrada se generan varias distribuciones y se queda la mejor.
- **B4 Inventario de la foto guardado** — columna JSON nula `photoInventory` (migración Prisma) para
  que "Otra distribución" reutilice lo detectado.

Pruebas: `pytest` de la pasada de decoración y del puntaje; contrato en `test_contract.py`; e2e: un
proyecto nuevo de cada tipo tiene un mínimo de piezas y cero errores de `design-check`.

## C — Demo sin registro y plantillas

- Puerto `ProjectPersistence` con `ApiPersistence` y `LocalPersistence` (`localStorage`), patrón
  Strategy, inyectado en `features/project/design-project.store.ts`.
- Ruta `/demo/:plantilla` (editor completo, sin cuenta) y galería `/plantillas` con 6–8 cuartos
  amueblados: JSON generados con el motor de B y versionados en un archivo nuevo
  `shared-types/src/furnished-templates.ts` (`room-templates.ts` solo tiene formas de planta),
  validados con zod en una spec. También se ofrecen como punto de partida en el asistente.
- "Guardar en mi cuenta": tras registrarse, `POST /projects/import` crea el proyecto desde el estado
  local (validado con los esquemas de `shared-types`, con límite de tamaño y de frecuencia).

Pruebas: spec de `LocalPersistence`; e2e `demo.spec.ts` (abrir plantilla, editar, recargar y conservar,
registrarse e importar).

## D — Landing editorial

**Sistema visual** (`apps/web/src/styles.scss`, se conservan los tokens y la prueba de contraste):
marfil como fondo casi único y una sola sección profunda en petróleo; se eliminan los fondos tintados
alternos y los bordes de tarjeta, sustituidos por aire y filetes finos. Fraunces en tamaño de
exhibición con escala fluida (`clamp`, hasta ~6 rem) y una frase en cursiva por titular; Inter para el
texto. Rejilla de 12 columnas, ancho máximo 1200 px, ritmo vertical de 96–160 px.

**Secciones** (ocho, una idea cada una; `features/home/home.page.ts` y componentes nuevos junto a él):

1. **Encabezado** — titular grande ("Tu cuarto, antes de mover un solo mueble."), una línea de apoyo,
   CTA "Diseñar mi cuarto" y secundario "Probar sin cuenta" (→ C). Debajo, **un render a todo el
   ancho** con luz de tarde y un conmutador día / tarde / noche que funde imágenes. Sin three.js en
   la landing. Sustituye a `hero.component.ts`.
2. **Tres pasos en una línea** — 01 Foto · 02 Plano · 03 Recorrer, numerales en serif sobre un filete.
3. **Antes y después** — deslizador accesible (`<input type="range">`, teclado) entre una foto real y
   el cuarto 3D que la app sacó de ella. Nuevo `before-after.component.ts`.
4. **El editor** — texto fijo a la izquierda con cuatro capacidades y captura grande a la derecha que
   cambia al avanzar (sustituye a `feature-gallery.component.ts`; reutiliza `FEATURES`).
5. **Estilos** — pestañas: foto de ambiente + el mismo cuarto renderizado en ese estilo + paleta + tres
   piezas con precio del catálogo; el CTA abre el asistente con `?estilo=` (ya funciona; amplía
   `style-cards.component.ts`).
6. **Plantillas** — mosaico de cinco cuartos que abren la demo.
7. **Qué reconoce y qué estima** — dos columnas compactas, con las cifras reales integradas en el
   texto en numerales serif (desaparece `stats-band` como franja).
8. **Preguntas y cierre** — ocho preguntas a dos columnas (absorben la tabla "con foto / sin foto") y
   cierre sobre petróleo con render. Pie más sobrio.

Cabecera transparente sobre el encabezado y sólida al desplazarse (`app.ts`). Movimiento: `appReveal`
existente más `animation-timeline: view()` tras `@supports`, siempre respetando menos movimiento.
Mismo lenguaje en el panel de acceso, el 404 y el estado vacío de "Mis proyectos".

**Imágenes** — script reproducible `e2e/scripts/landing-shots.mjs` (Playwright) que abre plantillas y
guarda las capturas en AVIF/WebP a varios anchos: se acaba el rehacerlas a mano. `srcset`, dimensiones
fijas, carga diferida bajo el pliegue, `fetchpriority` en la del encabezado. Fotos libres (6 como
mucho) en `apps/web/public/landing/` con `ATTRIBUTION.md`. Presupuesto: imagen principal ≤ 150 kB,
landing completa ≤ 900 kB en imágenes, bundle inicial sin subir.

Pruebas: specs del deslizador y de las pestañas; axe en escritorio y móvil; sin desborde a 320, 768,
1024 y 1440; `home.spec.ts` actualizado; revisión visual en claro y oscuro.

## E — Robustez

Ya existe y no se toca: guardado con reintentos, aviso sin conexión, borrador local, `beforeunload`
(`features/project/save-resilience.ts`), `ErrorHandler` global, rutas perezosas, presupuestos de
bundle en CI, límites por ruta en Redis, validación zod, health, logs con `x-request-id`.

**Web (lo que falta)**
- Conflicto 409 con fusión: hoy `rebaseOrConflict` solo reenvía si el servidor no cambió; pasa a
  reaplicar la edición cuando cambió otra parte de la escena (función pura en `shared-types`).
- Botón "Reintentar" en el aviso de error (`app.config.ts`, `AppErrorHandler`).
- Táctil y móvil: un dedo mueve, dos mueven la cámara, tiradores más grandes
  (`scene/drag-controller.ts`, `gizmo-view.ts`); panel del editor como hoja inferior bajo 960 px;
  specs `@mobile` del editor.
- axe sobre el editor, el asistente y "Mis proyectos" (`e2e/tests/a11y.spec.ts` solo cubre lo público).
- Componentes base en `shared/ui/` (`dialog`, `tabs`, `segmented`, `tooltip`): hoy se repiten como
  clases y `<dialog>` sueltos; partir `editor.component.ts` (595 líneas) en barra, panel y escenario.
- Primeros pasos: recorrido guiado de cuatro pasos la primera vez que se abre el editor.

**API**
- Partir `projects.service.ts` (629 líneas) en servicios por responsabilidad (proyectos, escena,
  cuarto, versiones, compartir) y segregar `IProjectRepository` (`ports/index.ts`); sin cambio de
  comportamiento. Se hace **antes de G**, que toca justo ese código.
- Llamadas al servicio de IA con tiempo límite, reintento acotado y cortacircuitos; encolado de
  trabajos idempotente.
- Cuota y caché de visión en Redis (hoy por proceso, anotado en ADR-0011).
- Umbral de cobertura en `shared-types` y `api`; `e2e/resilience.mjs` dentro del job e2e.

**IA** — límites de tamaño y tipo de imagen, tiempo límite por proveedor, y que el respaldo
(`providers/fallback.py`) quede cubierto por pruebas de fallo.

Pruebas: specs del guardado con red simulada, e2e `offline-save.spec.ts`, pruebas de los servicios
partidos (las actuales, antes y después).

## F — Exportar y presentar

- **PDF del proyecto**: se amplía el generador que ya hace el PDF de compras
  (`apps/api/src/modules/projects/shopping-list.pdf.ts`) a un dossier: portada con render, plano
  acotado (el SVG de `exportPlan`), cuadro de medidas y lista de compras (el CSV ya existe).
- **Imagen en alta resolución** con `capturePng(escala)` (A6).
- **Modo presentación** `/proyecto/:id/presentar`: pantalla completa, flechas del teclado, secuencia
  plano → vistas → recorrido automático → día/tarde/noche → lista de compras. Pensado para la sustentación.
- **Presupuesto**: tope por proyecto, total por categoría y aviso al superarlo.
- **Comparar versiones**: miniatura por versión y vista lado a lado antes de restaurar.

## G — Varios cuartos por proyecto

Cambia la decisión "un cuarto por proyecto" (ADR nuevo). Por etapas, cada una desplegable:

- **G1 Modelo y API** — tabla `Room` (tipo, `roomShell`, `placements`, `finishes`, foto, `revision`,
  orden); la migración crea un cuarto por cada proyecto existente copiando sus columnas. Rutas
  `/projects/:id/rooms/:roomId/...`; las rutas actuales siguen funcionando y apuntan al primer cuarto.
  Las versiones guardan todos los cuartos. La concurrencia optimista pasa a ser por cuarto.
- **G2 Editor** — `activeRoomId` en el store, pestañas de cuartos, "Añadir cuarto" reutilizando el
  asistente, renombrar / duplicar / quitar cuarto. Deshacer es por cuarto.
- **G3 Vivienda** — vista de planta con todos los cuartos, que se colocan y se pegan entre sí
  (`snapping.ts`); cifras y lista de compras del proyecto entero; tarjeta de "Mis proyectos" con el
  número de cuartos; PDF y presentación recorren todos.
- Fuera de alcance: caminar de un cuarto a otro en 3D y puertas compartidas con geometría común.

Pruebas: migración probada con datos reales de la demo (antes/después), specs de servicio, e2e
`rooms.spec.ts`, y la suite actual en verde sin tocar (compatibilidad).

## H — Cierre

ADR-0018 a 0021 (posprocesado y calidad, demo y persistencia local, landing editorial, varios
cuartos), README y capturas nuevas, y el diagrama de clases con los patrones que aún no existe en `docs/`. Despliegue en Railway de `api`, `worker`,
`web` y `ai` con `prisma migrate deploy`; **aprobar este plan autoriza ese despliegue** al final de
los bloques D y G. La clave de Groq sigue solo en `.env` y en Railway; pendiente de que la rotes.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El posprocesado baja los fps en portátiles | Carga perezosa, calidad adaptativa, AO a media resolución |
| El antes/después con foto real no queda convincente | Se elige la foto probando varias con el analizador real; si ninguna sirve, el deslizador pasa a "vacío ↔ amueblado" |
| Fotos libres con licencia dudosa | Solo CC0 o licencia equivalente, registradas en `ATTRIBUTION.md`, autoalojadas |
| La migración a `Room` pierde datos | Migración aditiva (las columnas viejas se quedan una versión), copia de la base antes, prueba con datos de la demo |
| G rompe rutas y pruebas existentes | Rutas antiguas como alias del primer cuarto; la suite actual debe pasar sin cambios |
| El plan es muy grande | Bloques independientes y desplegables; A–D ya dan la landing nueva; G puede posponerse |
| Límites por IP en e2e | `RATE_LIMIT_MULTIPLIER=20` como hasta ahora |

## Verificación

- Por commit: `./scripts/toolbox.sh "npm run build:types && npm test -w @interiores/shared-types &&
  npm test -w api && npm test -w web && npm run lint"`; en `services/ai`: `ruff`, `mypy`, `pytest`.
- Por bloque: `./scripts/build-images.sh api ai web`, stack con
  `RATE_LIMIT_MULTIPLIER=20 ROOM_ANALYZER=mock docker compose up -d --no-build --wait`, suite Playwright
  completa dos veces seguidas en verde.
- Visual: capturas de la landing (claro, oscuro, móvil) y del visor (día, tarde, noche) revisadas a
  ojo antes de cada commit visual, comparadas con las actuales de `docs/capturas/landing/`.
- Rendimiento: tamaño del bundle inicial y peso de imágenes dentro del presupuesto; fps del visor con
  calidad alta y media.
- Final: despliegue, `node e2e/smoke.mjs <url>` y e2e contra la URL pública.
- Git: `git log --format='%an <%ae> | %cn'` solo muestra a Steven; sin atribuciones.

## Fuentes consultadas

planner5d.com · rayon.design · spacely.ai · havenly.com · arcadium3d.com · floorplanner.com ·
interiorai.com · home.by.me · contra.com (caso Archime) · line25.com (tendencias 2026) ·
discourse.threejs.org (ambiente realista en escenas de arquitectura) · github.com/N8python/n8ao
