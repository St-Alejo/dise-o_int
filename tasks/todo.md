# Tareas: plan v6 (landing editorial, 3D más real, robustez y funciones nuevas)

Plan completo en [`plan.md`](plan.md). Rutas relativas a `diseño de interiores/`; `v3d/` abrevia
`apps/web/src/app/features/viewport-3d/`.

Órdenes de verificación (las del repo):
- **Unitarias y lint:** `./scripts/toolbox.sh "npm run build:types && npm test -w @interiores/shared-types && npm test -w api && npm test -w web && npm run lint"`.
- **IA:** `ruff`, `mypy` y `pytest` en `services/ai`.
- **Imagen y stack:** `./scripts/build-images.sh api ai web` y
  `RATE_LIMIT_MULTIPLIER=20 ROOM_ANALYZER=mock docker compose up -d --no-build --wait`.
- **e2e:** la suite Playwright en contenedor contra `http://host.docker.internal:8088`.

Cada tarea cierra con pruebas en verde, commit y push.

## Estado y desviaciones (2026-10-11)

Hechos los bloques A (salvo A4, A7 y la cámara cenital de A6), B (salvo B3), C, D (salvo D8), F1 a F3, E7 y
una primera versión de G (viviendas).

- **A4:** el kit de muebles ya tenía cantos redondeados y materiales con brillo; las texturas PBR
  descargadas se descartaron (peso en el repositorio). Ver ADR-0018.
- **A2:** foco ancho por ventana en vez de luz de área; el entorno sigue siendo `RoomEnvironment`.
- **B1:** el catálogo ya traía la decoración; faltaba que alguien la colocara (B2).
- **B2:** la pasada de decoración vive en `shared-types` (TypeScript) y la aplica la API, no el
  servicio de IA. Ver ADR-0019.
- **D4:** el antes y después compara el cuarto vacío con el amueblado, no una foto con su 3D.
- **D:** sin fotos de terceros; la cabecera sigue sólida. Ver ADR-0020.
- **F1:** el PDF lleva ficha, plano acotado y compras; no lleva render (el servidor no dibuja 3D).
- **G:** viviendas como agrupación de cuartos, no como tabla `Room`; sin planta conjunta. Ver ADR-0021.
- **Segunda tanda (misma fecha):** hechos A7, B3, D8, E1 a E6, E8, F4, F5 y la vista cenital de A6.
- **Tercera tanda (misma fecha):** lo que la segunda dejó a medias. Ver ADR-0022.
  - La vista cenital es ortográfica (`RoomCamera`).
  - El tope de presupuesto se guarda con el proyecto.
  - Diálogo y ayuda como piezas base (`app-dialog`, `appTooltip`); la ayuda se aplicó a la barra
    del editor y al visor, el resto de la app conserva `title`.
  - `editor.component.ts` partido en barra, panel y escenario.
  - Planta conjunta de la vivienda (G3): cuartos a escala que se arrastran y se pegan, y la
    vivienda entera en un PDF.
  - Fotos CC0 en la sección de estilos, con su atribución.
- **Sigue fuera:** tabla `Room` y pestañas de cuartos dentro de un mismo editor (G1 y G2 se
  resolvieron como viviendas, ADR-0021); puertas compartidas y caminar entre cuartos; presentación
  de la vivienda entera; texturas PBR (A4).
- **CI:** el trabajo e2e llevaba decenas de commits fallando en su primer paso (un script sin
  permiso de ejecución). Corregido; desde entonces Playwright corre también en GitHub.
- De paso: una prueba de propiedades de la cocina fallaba en `main` (un mueble quedaba 5 mm fuera
  por redondeo) y la franja de datos del proyecto tenía una lista de definiciones mal formada.

## A — 3D más real

- [x] **A1 Posprocesado.** `v3d/scene/post-fx.ts` cargado con `import()`: oclusión ambiental y contorno
  de selección y de hover. *Hecho cuando:* el visor pinta por el composer sin perder el render bajo
  demanda; `window.__scene.postFx` lo refleja; el bundle inicial no sube.
- [x] **A2 Luz.** Luz de ventana, sombras suaves, entorno del propio cuarto y preset `tarde`.
  *Hecho cuando:* hay tres horas con spec de presets y el botón del visor las recorre.
- [x] **A3 Paredes en corte.** Las paredes que tapan la cámara se ven cortadas, no translúcidas.
  *Hecho cuando:* la decisión es una función pura con spec y al recorrer las paredes van enteras.
- [ ] **A4 Materiales y detalle.** Texturas PBR autoalojadas, cantos redondeados, paletas de pared
  desaturadas. *Hecho cuando:* `ATTRIBUTION.md` lista cada textura y los proyectos viejos abren igual.
- [x] **A5 Calidad adaptativa y recuperación.** `v3d/scene/quality.ts` y `webglcontextrestored`.
  *Hecho cuando:* los escalones tienen spec y perder el contexto no obliga a recargar.
- [x] **A6 Cámara y captura.** Cenital ortográfica y `capturePng(escala)`.
- [x] **A7 Restos del visor.** "Cambiar" en la barra contextual, pintar el techo, materiales del mueble
  con la herramienta de pintar.

### Punto de control A
- [ ] Unitarias, lint y e2e en verde; capturas de día, tarde y noche revisadas a ojo.

## B — Cuartos menos vacíos

- [x] **B1 Catálogo de decoración.** Cuadros, espejos, plantas, cortinas, alfombras, lámparas.
- [x] **B2 Pasada de decoración** en `rules_engine.py` (pared y superficie) y kits de cocina y baño.
- [x] **B3 Puntuación.** `layout/scoring.py`: varias candidatas, gana la mejor.
- [x] **B4 Inventario de la foto guardado** (`photoInventory`, migración aditiva).

### Punto de control B
- [x] `pytest` y contrato en verde; un cuarto nuevo de cada tipo sale amueblado y sin errores de revisión.

## C — Demo sin registro y plantillas

- [x] **C1 Puerto `ProjectPersistence`** con `ApiPersistence` y `LocalPersistence`.
- [x] **C2 Plantillas amuebladas** en `shared-types/src/furnished-templates.ts`, con spec.
- [x] **C3 Rutas `/demo/:plantilla` y `/plantillas`.**
- [x] **C4 Guardar la demo en la cuenta** (`POST /projects/import`).

### Punto de control C
- [x] e2e `demo.spec.ts` en verde.

## D — Landing editorial

- [x] **D1 Sistema editorial** en `styles.scss`: escala fluida, rejilla, filetes, sin fondos alternos.
- [x] **D2 Capturas reproducibles** (`e2e/scripts/landing-shots.mjs`) y fotos libres con atribución.
- [x] **D3 Encabezado** con render a todo el ancho y conmutador de hora.
- [x] **D4 Pasos y antes/después** (`before-after.component.ts`).
- [x] **D5 El editor** (texto fijo y captura que cambia).
- [x] **D6 Estilos y plantillas.**
- [x] **D7 Qué reconoce, preguntas, cierre, cabecera y pie.**
- [x] **D8 Mismo lenguaje** en acceso, 404 y estado vacío.

### Punto de control D
- [x] axe y desborde (320–1440) en verde; pesos dentro del presupuesto; despliegue y humo en producción.

## E — Robustez

- [x] **E1 Partir `projects.service.ts`** y segregar el repositorio (sin cambio de comportamiento).
- [x] **E2 Fusión en el 409** y botón "Reintentar".
- [x] **E3 Táctil y móvil** del editor, con specs `@mobile`.
- [x] **E4 axe** en editor, asistente y proyectos.
- [x] **E5 Componentes base** en `shared/ui` y partir `editor.component.ts`.
- [x] **E6 IA con tiempo límite y cortacircuitos;** cuota y caché de visión en Redis.
- [x] **E7 Umbral de cobertura** y `resilience.mjs` en CI.
- [x] **E8 Primeros pasos** (recorrido guiado).

## F — Exportar y presentar

- [x] **F1 PDF del proyecto.**
- [x] **F2 Imagen en alta resolución.**
- [x] **F3 Modo presentación.**
- [x] **F4 Presupuesto con tope.**
- [x] **F5 Comparar versiones.**

## G — Varios cuartos por proyecto

- [x] **G1 Modelo y API.** Resuelto como viviendas (`homeId`), sin tabla `Room`: ADR-0021.
- [x] **G2 Editor.** Cada cuarto conserva su editor; se pasa de uno a otro por la barra de la vivienda.
- [x] **G3 Vivienda** (planta conjunta, totales y presupuesto de la vivienda): ADR-0022.

## H — Cierre

- [x] ADR-0018 a 0022, README, capturas y diagrama de clases.
- [x] Despliegue en Railway y e2e contra la URL pública.

## Plan v8 — Modo Pro (2026-11-01)

Plan en `~/.claude/plans/ethereal-questing-rainbow.md`; decisiones en los ADR-0028 a 0033.

- [x] Fase 0: ficha técnica (`TechnicalSpec`), `User.proMode`, pestaña Pro y muros con grosor.
- [x] Fase 1: modelo de dibujo, plantas, alzados, corte, láminas con cajetín, SVG/DXF/PDF.
- [x] Fase 2: normativa (Neufert y Colombia), cálculo de iluminación y luz natural, informe PDF.
- [x] Fase 3: cómputo métrico, APU y AIU, desperdicio por dibujo, compras, cronograma, CSV/PDF.
- [x] Fase 4: instalaciones (propuesta, circuitos, cuadro de cargas, planos, reglas RETIE).
- [x] Fase 5: intenciones de chat, plantilla profesional, diagrama de clases y ADR de cierre.
- [ ] Despliegue de los hitos 1–3 en Railway: pendiente de `railway login` (la CLI no tiene sesión).
  Pasos: migraciones `20261020000000_design_brief`, `20261021000000_recommendation_feedback` y
  `20261101000000_pro_mode` por proxy TCP, `GROQ_API_KEY` en el servicio api (desde `.env`),
  `railway up` de api/worker/web/ai, resembrar y e2e de humo contra la URL pública.

### Desviaciones
- La ficha técnica se guarda aparte de la escena y no entra en el `CommandHistory` (deshacer de la
  escena no la revierte; cada cambio se guarda al momento y, si falla, vuelve).
- El 3D usa muros de 12 cm sin leer la ficha; el plano editable no dibuja el grosor.
- El corte se define con un formulario (eje y posición), no trazándolo en el plano. Las láminas no
  llevan norte (el cuarto no tiene orientación).
- Lúmenes por subcategoría de lámpara, no como atributo del catálogo. El cálculo de luz no tiene
  sombras ni evalúa las zonas cerradas (baño privado) en la rejilla.
- Las puertas existentes del cuarto no se presupuestan, solo las de los tabiques nuevos.
- Los puntos de instalación se editan desde el panel (borrar o añadir a mano), no arrastrándolos
  en el plano, y no se ven como marcadores en el 3D. Sin cálculo de caída de tensión.
- El Modo Pro no está en la demo sin cuenta.
- `e2e/tests/customize.spec.ts` falla desde antes de la v8 ("Con esas medidas no cabe en ningún
  lugar libre del cuarto" al poner el sofá a 240 cm en un cuarto lleno); chat, homes y zz-catalog son
  inestables con carga y pasan al repetir.
