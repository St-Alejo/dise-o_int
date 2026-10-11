# Tareas: rediseño visual

Plan completo en [`plan.md`](plan.md). Rutas relativas a `diseño de interiores/`; `web/` abrevia
`apps/web/src/app/`.

Órdenes de verificación (las del repo):
- **Unitarias y lint:** `./scripts/toolbox.sh "npm run build:types && npm test -w web && npm run lint -w web"`
  (añadir `npm test -w @interiores/shared-types && npm test -w api` cuando la tarea los toque).
- **Imagen y stack:** `./scripts/build-images.sh web` y
  `RATE_LIMIT_MULTIPLIER=20 ROOM_ANALYZER=mock docker compose up -d --no-build --wait`.
- **e2e:** la suite Playwright en contenedor contra `http://host.docker.internal:8088`.

Cada tarea cierra con pruebas en verde, un commit (Conventional Commits en español, sin atribución)
y `git push`.

---

## Fase 1 — Cimientos

### T1: Paleta nueva en los tokens, con prueba de contraste

**Descripción:** Cambiar los valores de color de `:root` y de `dark-tokens` a la paleta "Petróleo y
arcilla" y añadir los tokens `--accent-soft`, `--highlight`, `--gradient-brand`, `--tint-1…3` y
`--ring`. Una prueba lee `styles.scss`, resuelve los tokens de cada tema y comprueba el contraste.

**Criterios de aceptación:**
- [ ] Toda la app cambia de marrón a verde petróleo con acento arcilla, en claro y en oscuro, sin tocar componentes.
- [ ] Cada par texto/fondo que la interfaz usa (`text`/`bg`, `text-muted`/`surface`, `on-primary`/`primary`, `primary-strong`/`primary-soft`, `accent`/`surface`, y los de `danger`, `warning`, `success`) llega a 4.5:1 en los dos temas.
- [ ] El anillo de foco se sigue viendo sobre `--bg`, `--surface` y `--primary` (3:1).

**Verificación:**
- [ ] Unitarias y lint en verde, incluida la spec nueva de contraste.
- [ ] `a11y.spec.ts` en verde.
- [ ] A ojo: `/` y `/entrar` en claro y oscuro.

**Dependencias:** ninguna

**Archivos:**
- `apps/web/src/styles.scss`
- `apps/web/src/design-tokens.spec.ts` (nuevo)

**Tamaño:** S

### T2: Tipografía autoalojada y escala tipográfica

**Descripción:** Añadir Fraunces (títulos) e Inter (texto) como woff2 variables en
`public/fonts/`, declararlas con `@font-face` y `font-display: swap`, y definir la escala
`--text-xs…--text-3xl` con la que se escriben `h1–h3`, `.lead` y `.fine`.

**Criterios de aceptación:**
- [ ] Títulos y texto usan las fuentes nuevas sin pedir nada a otro dominio (la CSP no cambia).
- [ ] Las dos fuentes suman menos de 120 kB y solo la de texto va con `preload`.
- [ ] Hay un `ATTRIBUTION.md` con la licencia OFL de cada una.

**Verificación:**
- [ ] Unitarias y lint en verde; build de producción sin superar el aviso de 450 kB.
- [ ] A ojo: pestaña Red sin peticiones externas y sin salto de diseño al cargar la fuente.

**Dependencias:** T1

**Archivos:**
- `apps/web/public/fonts/` (2 woff2 + `ATTRIBUTION.md`)
- `apps/web/src/styles.scss`
- `apps/web/src/index.html`

**Tamaño:** S

### T3: Clases base renovadas y colores sueltos a tokens

**Descripción:** Dar más carácter a las clases compartidas (`.btn`, `.card`, `.chip`, `.badge`,
`.input`) y añadir las que usarán las páginas: `.section` / `.section-tint`, `.eyebrow`, `.stat`,
`.kicker`, `.card-hover`. Sustituir por tokens los colores escritos a mano en la interfaz (no en
el visor 3D).

**Criterios de aceptación:**
- [ ] Botones, tarjetas, chips e insignias tienen estados de reposo, hover, foco, pulsado y deshabilitado distinguibles en los dos temas.
- [ ] No queda ningún color fijo de interfaz en `app.ts`, `editor.component.ts`, `inspector.component.ts`, `compare-slider.component.ts`, `three-viewport.component.ts` ni en `.scene-label` (los de materiales y luces del visor se quedan).
- [ ] El editor se ve coherente con la paleta nueva sin cambios de comportamiento.

**Verificación:**
- [ ] Unitarias y lint en verde.
- [ ] Suite e2e completa en verde.
- [ ] A ojo: editor (barras, inspector, catálogo) en claro y oscuro.

**Dependencias:** T2

**Archivos:**
- `apps/web/src/styles.scss`
- `web/app.ts`
- `web/features/viewport-3d/editor.component.ts`, `three-viewport.component.ts`
- `web/features/inspector/inspector.component.ts`
- `web/features/style-gallery/compare-slider.component.ts`

**Tamaño:** M

## Punto de control A — después de T1–T3
- [ ] Unitarias, lint y suite e2e completa (35/35) en verde
- [ ] Capturas de `/`, `/entrar`, `/proyectos` y el editor en claro y oscuro, revisadas
- [ ] **El usuario confirma la paleta y las fuentes antes de seguir**

---

## Fase 2 — Landing

### T4: Cabecera y pie con más contenido

**Descripción:** Cabecera con enlaces a las secciones de la landing (Cómo funciona, Qué hace,
Estilos, Preguntas) y menú plegable en móvil. Pie de varias columnas: producto, privacidad de las
fotos, tecnología del proyecto y enlace al repositorio.

**Criterios de aceptación:**
- [ ] Desde la cabecera se llega a cada sección de la landing con teclado y con ratón; en 320 px el menú se abre y se cierra con Escape.
- [ ] El pie dice qué es el proyecto, qué pasa con las fotos y con qué está hecho, y se lee bien en móvil.
- [ ] El logo usa `currentColor`/tokens y se ve bien en los dos temas.

**Verificación:**
- [ ] Unitarias y lint en verde; `a11y.spec.ts` en verde en escritorio y `@mobile`.
- [ ] A ojo: 320, 768 y 1440 px.

**Dependencias:** T3

**Archivos:**
- `web/app.ts`
- `web/shared/ui/icon.component.ts` (iconos de menú y enlace externo)
- `e2e/tests/a11y.spec.ts` (si hace falta abrir el menú)

**Tamaño:** S

### T5: Hero con color y vista previa real

**Descripción:** Rehacer el encabezado de la landing: fondo con el degradado de marca, titular con
una palabra resaltada en el acento, tres ventajas con icono bajo los botones y, junto al plano
interactivo, una captura del 3D del mismo cuarto para que se vea el resultado.

**Criterios de aceptación:**
- [ ] El hero muestra a la vez el plano interactivo (cambia con las formas, como hoy) y una vista 3D real.
- [ ] El botón principal sigue llamándose "Diseñar mi cuarto" y lleva al mismo sitio.
- [ ] En 320 px no hay scroll horizontal y el botón principal se ve sin desplazarse.

**Verificación:**
- [ ] Unitarias y lint en verde; `a11y.spec.ts` y `wizard.spec.ts` en verde.
- [ ] A ojo: claro, oscuro y móvil.

**Dependencias:** T3

**Archivos:**
- `web/features/home/home.page.ts`
- `web/features/home/hero.component.ts` (nuevo; `home.page.ts` ya tiene 390 líneas)
- `apps/web/public/landing/` (captura 3D por forma)

**Tamaño:** M

### T6: Franja de cifras y sección "qué reconoce de tu foto"

**Descripción:** Una franja con cifras reales (piezas del catálogo, categorías, estilos, formas y
tipos de cuarto) leídas del catálogo público y de `shared-types`, y una sección que explica con
iconos qué saca la app de una foto (puertas, ventanas, muebles, colores, medidas aproximadas) y
qué no.

**Criterios de aceptación:**
- [ ] Las cifras salen de datos reales; si el catálogo no responde, la franja muestra solo las que no dependen de la red, sin huecos ni errores.
- [ ] La sección dice con honestidad qué es estimado (medidas) y qué es fiable (aberturas, muebles, colores).
- [ ] Cada elemento lleva icono y texto (el color no es la única señal).

**Verificación:**
- [ ] Unitarias en verde, con una spec del componente de cifras (con catálogo y sin él).
- [ ] A ojo: con la API caída la landing sigue entera.

**Dependencias:** T3

**Archivos:**
- `web/features/home/stats-band.component.ts` (+ `.spec.ts`, nuevos)
- `web/features/home/home.page.ts`
- `web/shared/ui/icon.component.ts`

**Tamaño:** M

### T7: Galería de capturas por pestañas

**Descripción:** Sustituir las tres funciones sueltas por una galería con pestañas — Editar en 3D,
Recorrer, Día y noche, Plano y medidas, Pintar y materiales — cada una con captura real, dos o
tres frases y sus atajos. Las imágenes salen de `docs/capturas/`, optimizadas.

**Criterios de aceptación:**
- [ ] Cinco pestañas con patrón `tablist` accesible (flechas, Inicio, Fin) y captura con texto alternativo.
- [ ] Cada imagen pesa menos de 150 kB, carga con `lazy` y no mueve el diseño al aparecer.
- [ ] En móvil las pestañas se desplazan en horizontal sin romper la página.

**Verificación:**
- [ ] Unitarias y lint en verde; `a11y.spec.ts` en verde.
- [ ] A ojo: recorrer las pestañas solo con teclado.

**Dependencias:** T3

**Archivos:**
- `web/features/home/feature-gallery.component.ts` (+ `.spec.ts`, nuevos)
- `web/features/home/home.page.ts`
- `apps/web/public/landing/` (5–6 imágenes)

**Tamaño:** M

### T8: Aparición al hacer scroll

**Descripción:** Directiva `appReveal` con `IntersectionObserver` que hace aparecer las secciones
al entrar en pantalla. Sin JavaScript de animación: solo cambia una clase.

**Criterios de aceptación:**
- [ ] Las secciones de la landing aparecen una vez, sin parpadeo ni salto de diseño.
- [ ] Con `prefers-reduced-motion` o sin `IntersectionObserver`, el contenido se ve desde el principio.
- [ ] El contenido es visible para axe y para las pruebas sin esperar animaciones.

**Verificación:**
- [ ] Unitarias en verde, con spec de la directiva (visible por defecto sin observador).
- [ ] `a11y.spec.ts` en verde.

**Dependencias:** T3

**Archivos:**
- `web/shared/ui/reveal.directive.ts` (+ `.spec.ts`, nuevos)
- `apps/web/src/styles.scss`
- `web/features/home/home.page.ts`

**Tamaño:** S

### T9: Estilos, comparativa con foto / sin foto, FAQ ampliada y cierre

**Descripción:** Tarjetas de estilo con paleta grande, materiales típicos y enlace para empezar con
ese estilo; tabla comparativa "con foto" frente a "sin foto"; FAQ de 4 a 8 preguntas (costo,
dispositivos, compartir, medidas, privacidad, deshacer); cierre con el degradado de marca.

**Criterios de aceptación:**
- [ ] Cada estilo muestra su paleta, su descripción y un botón que abre el asistente con ese estilo ya elegido.
- [ ] La comparativa se lee como tabla en escritorio y como lista en móvil, con cabeceras correctas para lectores de pantalla.
- [ ] La FAQ tiene 8 preguntas respondidas con lo que la app hace de verdad.

**Verificación:**
- [ ] Unitarias y lint en verde; `a11y.spec.ts` y `wizard.spec.ts` en verde.
- [ ] A ojo: el botón de un estilo llega al asistente con el estilo marcado.

**Dependencias:** T5, T6, T7, T8

**Archivos:**
- `web/features/home/home.page.ts`
- `web/features/home/style-cards.component.ts` (nuevo)
- `web/features/new-project/new-project.page.ts` (leer el estilo de la URL)
- `e2e/tests/wizard.spec.ts`

**Tamaño:** M

## Punto de control B — después de T4–T9
- [ ] `a11y.spec.ts` en verde en escritorio y `@mobile`
- [ ] Sin desbordes a 320, 768, 1024 y 1440 px
- [ ] Bundle inicial bajo el aviso de 450 kB
- [ ] El usuario revisa la landing

---

## Fase 3 — Páginas de la app

### T10: Entrar y registro a dos columnas

**Descripción:** Junto al formulario, un panel con una captura real y tres ventajas (qué obtienes al
crear la cuenta, qué pasa con tus fotos). En móvil el panel pasa debajo. El formulario no cambia
de campos ni de textos.

**Criterios de aceptación:**
- [ ] `/entrar` y `/registro` muestran formulario y panel en escritorio, y solo una columna en móvil con el formulario primero.
- [ ] Etiquetas, mensajes de error y botones conservan su texto y su orden de tabulación.
- [ ] Los estilos en línea (`style="…"`) del formulario pasan a clases.

**Verificación:**
- [ ] Unitarias y lint en verde; `a11y.spec.ts` y `flow.spec.ts` en verde.

**Dependencias:** T3

**Archivos:**
- `web/features/auth/auth.page.ts`
- `apps/web/public/landing/` (una captura)

**Tamaño:** S

### T11: La lista de proyectos trae área, estilos y total estimado

**Descripción:** Añadir a `ProjectListItemSchema` los campos opcionales `areaM2`, `styles` y
`estimatedTotal`, calculados en el servidor a partir del cuarto y de los muebles con las funciones
que ya existen en `shared-types` (polígono y lista de compras).

**Criterios de aceptación:**
- [ ] `GET /api/projects` devuelve los tres campos para proyectos listos y los omite si no se pueden calcular.
- [ ] Un cliente que ignore los campos nuevos sigue funcionando (son opcionales; sin migración).
- [ ] La lista no hace una consulta extra por proyecto.

**Verificación:**
- [ ] `npm test -w @interiores/shared-types` y `npm test -w api` en verde, con casos nuevos del listado.
- [ ] `projects-manage.spec.ts` en verde.

**Dependencias:** ninguna (se puede hacer en paralelo con la fase 2)

**Archivos:**
- `packages/shared-types/src/api.ts`
- `apps/api/src/modules/projects/` (servicio de listado y su spec)

**Tamaño:** S

### T12: Mis proyectos: resumen, filtros y tarjetas con más datos

**Descripción:** Encabezado con resumen (cuántos proyectos, cuántos sin guardar, área total),
filtro por tipo de cuarto y orden (recientes, nombre), y tarjetas con miniatura grande, área,
estilos como chips y total estimado. Estado vacío con ilustración y dos caminos (con foto, sin
foto). Fuera el emoji ⏳.

**Criterios de aceptación:**
- [ ] La tarjeta muestra tipo, área, nº de muebles, estilos, total y fecha; lo que falte no deja huecos.
- [ ] Filtro y orden funcionan junto con la búsqueda por nombre y se anuncian a lectores de pantalla.
- [ ] Renombrar, duplicar y borrar siguen igual (mismos textos y `aria-label`).

**Verificación:**
- [ ] Unitarias y lint en verde, con spec del filtrado y el orden.
- [ ] `projects-manage.spec.ts` en verde.
- [ ] A ojo: con 0, 1 y 9 proyectos (la cuenta demo tiene 9).

**Dependencias:** T3, T11

**Archivos:**
- `web/features/projects/projects.page.ts`
- `web/features/projects/project-card.component.ts` (nuevo)
- `web/features/projects/projects-filter.ts` (+ `.spec.ts`, nuevos)
- `web/shared/ui/icon.component.ts`

**Tamaño:** M

### T13: Asistente de proyecto nuevo con pasos visibles

**Descripción:** Barra de pasos con el actual resaltado, tarjetas de opción (con foto / sin foto,
tipo de cuarto, estilo) con icono y descripción, y una columna lateral que resume lo elegido hasta
el momento. Sin cambiar el flujo ni los nombres de los controles.

**Criterios de aceptación:**
- [ ] En todo momento se ve en qué paso se está y qué se ha elegido.
- [ ] Las opciones son botones o radios reales, con estado seleccionado visible sin depender solo del color.
- [ ] El flujo completo (con foto y sin foto) funciona igual que antes.

**Verificación:**
- [ ] Unitarias y lint en verde.
- [ ] `wizard.spec.ts`, `flow.spec.ts` y `room-shapes.spec.ts` en verde.

**Dependencias:** T3

**Archivos:**
- `web/features/new-project/new-project.page.ts`
- `web/features/new-project/wizard-steps.component.ts` (nuevo)
- `web/shared/ui/icon.component.ts`

**Tamaño:** M

### T14: Cabecera del proyecto, enlace público y 404

**Descripción:** Franja de datos del proyecto sobre el editor (área, nº de muebles, total
estimado, estado de guardado), la misma franja en el enlace público con una llamada a "crea el
tuyo", y una página 404 con ilustración y enlaces útiles.

**Criterios de aceptación:**
- [ ] El proyecto y el enlace público muestran área, muebles y total, y se actualizan al editar.
- [ ] El enlace público invita a crear un cuarto propio sin tapar el visor.
- [ ] La 404 ofrece volver al inicio y a "Mis proyectos".

**Verificación:**
- [ ] Unitarias y lint en verde.
- [ ] `walk.spec.ts` (incluye el enlace público) y `customize.spec.ts` en verde.

**Dependencias:** T3

**Archivos:**
- `web/features/project/project.page.ts`
- `web/features/project/project-facts.component.ts` (nuevo)
- `web/features/public/public-project.page.ts`
- `web/features/home/not-found.page.ts`

**Tamaño:** M

## Punto de control C — después de T10–T14
- [ ] Suite e2e completa en verde dos veces seguidas
- [ ] Flujo a mano: registro → proyecto nuevo → editor → compartir → enlace público
- [ ] El usuario revisa las páginas de la app

---

## Fase 4 — Cierre

### T15: Capturas, README, ADR-0017 y despliegue

**Descripción:** Rehacer las capturas de `docs/capturas/landing/`, documentar la paleta, las
fuentes y los tokens en el README y en un ADR-0017 (sistema visual), desplegar `web` y `api` en
Railway y repetir humo y e2e contra la URL pública.

**Criterios de aceptación:**
- [ ] README y ADR explican la paleta, la tipografía y cómo añadir un color o una sección.
- [ ] Capturas nuevas en claro, oscuro y móvil.
- [ ] Producción sirve el rediseño y pasa las pruebas.

**Verificación:**
- [ ] `railway deployment list` en `SUCCESS` para `web` y `api`; `/healthz` 200.
- [ ] `a11y.spec.ts` y `walk.spec.ts` en verde contra la URL pública.

**Dependencias:** T1–T14

**Archivos:**
- `README.md`
- `docs/adr/0017-sistema-visual.md` (nuevo)
- `docs/capturas/landing/`

**Tamaño:** S

## Punto de control final
- [ ] Todos los criterios de aceptación cumplidos
- [ ] Unitarias, lint y e2e en verde, local y en producción
- [ ] `git log --format='%an <%ae>'` solo muestra a Steven
