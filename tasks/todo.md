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

## A — 3D más real

- [ ] **A1 Posprocesado.** `v3d/scene/post-fx.ts` cargado con `import()`: oclusión ambiental y contorno
  de selección y de hover. *Hecho cuando:* el visor pinta por el composer sin perder el render bajo
  demanda; `window.__scene.postFx` lo refleja; el bundle inicial no sube.
- [ ] **A2 Luz.** Luz de ventana, sombras suaves, entorno del propio cuarto y preset `tarde`.
  *Hecho cuando:* hay tres horas con spec de presets y el botón del visor las recorre.
- [ ] **A3 Paredes en corte.** Las paredes que tapan la cámara se ven cortadas, no translúcidas.
  *Hecho cuando:* la decisión es una función pura con spec y al recorrer las paredes van enteras.
- [ ] **A4 Materiales y detalle.** Texturas PBR autoalojadas, cantos redondeados, paletas de pared
  desaturadas. *Hecho cuando:* `ATTRIBUTION.md` lista cada textura y los proyectos viejos abren igual.
- [ ] **A5 Calidad adaptativa y recuperación.** `v3d/scene/quality.ts` y `webglcontextrestored`.
  *Hecho cuando:* los escalones tienen spec y perder el contexto no obliga a recargar.
- [ ] **A6 Cámara y captura.** Cenital ortográfica y `capturePng(escala)`.
- [ ] **A7 Restos del visor.** "Cambiar" en la barra contextual, pintar el techo, materiales del mueble
  con la herramienta de pintar.

### Punto de control A
- [ ] Unitarias, lint y e2e en verde; capturas de día, tarde y noche revisadas a ojo.

## B — Cuartos menos vacíos

- [ ] **B1 Catálogo de decoración.** Cuadros, espejos, plantas, cortinas, alfombras, lámparas.
- [ ] **B2 Pasada de decoración** en `rules_engine.py` (pared y superficie) y kits de cocina y baño.
- [ ] **B3 Puntuación.** `layout/scoring.py`: varias candidatas, gana la mejor.
- [ ] **B4 Inventario de la foto guardado** (`photoInventory`, migración aditiva).

### Punto de control B
- [ ] `pytest` y contrato en verde; un cuarto nuevo de cada tipo sale amueblado y sin errores de revisión.

## C — Demo sin registro y plantillas

- [ ] **C1 Puerto `ProjectPersistence`** con `ApiPersistence` y `LocalPersistence`.
- [ ] **C2 Plantillas amuebladas** en `shared-types/src/furnished-templates.ts`, con spec.
- [ ] **C3 Rutas `/demo/:plantilla` y `/plantillas`.**
- [ ] **C4 Guardar la demo en la cuenta** (`POST /projects/import`).

### Punto de control C
- [ ] e2e `demo.spec.ts` en verde.

## D — Landing editorial

- [ ] **D1 Sistema editorial** en `styles.scss`: escala fluida, rejilla, filetes, sin fondos alternos.
- [ ] **D2 Capturas reproducibles** (`e2e/scripts/landing-shots.mjs`) y fotos libres con atribución.
- [ ] **D3 Encabezado** con render a todo el ancho y conmutador de hora.
- [ ] **D4 Pasos y antes/después** (`before-after.component.ts`).
- [ ] **D5 El editor** (texto fijo y captura que cambia).
- [ ] **D6 Estilos y plantillas.**
- [ ] **D7 Qué reconoce, preguntas, cierre, cabecera y pie.**
- [ ] **D8 Mismo lenguaje** en acceso, 404 y estado vacío.

### Punto de control D
- [ ] axe y desborde (320–1440) en verde; pesos dentro del presupuesto; despliegue y humo en producción.

## E — Robustez

- [ ] **E1 Partir `projects.service.ts`** y segregar el repositorio (sin cambio de comportamiento).
- [ ] **E2 Fusión en el 409** y botón "Reintentar".
- [ ] **E3 Táctil y móvil** del editor, con specs `@mobile`.
- [ ] **E4 axe** en editor, asistente y proyectos.
- [ ] **E5 Componentes base** en `shared/ui` y partir `editor.component.ts`.
- [ ] **E6 IA con tiempo límite y cortacircuitos;** cuota y caché de visión en Redis.
- [ ] **E7 Umbral de cobertura** y `resilience.mjs` en CI.
- [ ] **E8 Primeros pasos** (recorrido guiado).

## F — Exportar y presentar

- [ ] **F1 PDF del proyecto.**
- [ ] **F2 Imagen en alta resolución.**
- [ ] **F3 Modo presentación.**
- [ ] **F4 Presupuesto con tope.**
- [ ] **F5 Comparar versiones.**

## G — Varios cuartos por proyecto

- [ ] **G1 Modelo y API** (tabla `Room`, migración aditiva, rutas antiguas como alias).
- [ ] **G2 Editor** con pestañas de cuartos.
- [ ] **G3 Vivienda** (planta conjunta, totales del proyecto).

## H — Cierre

- [ ] ADR-0018 a 0021, README, capturas y diagrama de clases.
- [ ] Despliegue en Railway y e2e contra la URL pública.
