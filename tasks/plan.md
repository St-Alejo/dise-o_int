# Plan de implementación: rediseño visual — otros colores, más información, más atractivo

## Resumen

La web de Interiores IA funciona, pero se ve apagada: toda la interfaz vive en una gama de beige y
marrón (`--primary: #8a5a44` sobre `--bg: #f7f4ef`), el color de acento casi no se usa (10 apariciones),
las páginas internas son listas planas y la landing cuenta poco de lo que la app ya hace (no menciona
el catálogo, los tipos de cuarto, la revisión del diseño, el recorrido editable ni la lista de compras
con números). Este plan cambia la paleta, da jerarquía y ritmo visual a cada página y añade
información útil, **sin tocar el editor 3D por dentro** ni añadir dependencias.

Alcance: `apps/web` (estilos globales, cabecera y pie, landing, entrar/registro, mis proyectos,
asistente de proyecto nuevo, cabecera del proyecto, enlace público, 404) y un cambio pequeño de
contrato en `shared-types` + `api` para que la lista de proyectos traiga más datos.

Fuera de alcance: herramientas, gizmo y render del visor; el motor de distribución; el asistente de
chat. El cromado del editor (barras y paneles) hereda la paleta nueva por los tokens, nada más.

## Estado actual (lo que se leyó)

| Pieza | Archivo | Observación |
|---|---|---|
| Tokens y clases base | `apps/web/src/styles.scss` | Tokens claros y oscuros bien montados; una sola familia de color; sin escala tipográfica ni tokens de degradado/tinte |
| Cabecera, pie, avisos | `apps/web/src/app/app.ts` | Pie de una línea; el logo lleva `#fff` fijo |
| Landing | `features/home/home.page.ts` | Hero con plano interactivo, 3 pasos, 4 capturas, 6 estilos, FAQ. Sin cifras, sin iconos, secciones todas sobre el mismo fondo |
| Entrar / registro | `features/auth/auth.page.ts` | Tarjeta sola centrada en una página vacía |
| Mis proyectos | `features/projects/projects.page.ts` | Tarjetas con nombre, tipo, nº de muebles y fecha; queda un emoji (⏳); sin resumen ni filtros |
| Lista de proyectos (contrato) | `shared-types/src/api.ts` → `ProjectListItemSchema` | Solo `id, name, roomType, status, thumbnailUrl, itemCount, saved, updatedAt` |
| Catálogo | `apps/api/src/modules/catalog` | Endpoints públicos: la landing puede mostrar cifras reales sin sesión |
| Iconos | `shared/ui/icon.component.ts` | Trazos SVG propios en rejilla de 24; añadir uno es añadir una entrada |
| Capturas disponibles | `docs/capturas/{editor,visor,formas,luz,recorrido,texturas}` | Hay material real de sobra que la landing no usa |
| Restricciones | `infra/nginx/default.conf.template`, `angular.json` | CSP `font-src 'self'`, `img-src 'self'`; presupuesto inicial con aviso a 450 kB |
| Pruebas que protegen esto | `e2e/tests/a11y.spec.ts` | axe sin violaciones serias en `/`, `/entrar`, `/registro` (también `@mobile`) |

Colores escritos a mano fuera de los tokens: 69 apariciones en 16 archivos, casi todas dentro del
visor 3D (materiales y luces, que **no** se tocan). Las que sí son de interfaz están en `app.ts`,
`editor.component.ts`, `inspector.component.ts`, `compare-slider.component.ts`,
`three-viewport.component.ts` y las dos `.scene-label` de `styles.scss`.

## Decisiones de diseño

1. **Paleta nueva: "Petróleo y arcilla"** (recomendada; alternativas en Preguntas abiertas).
   Verde petróleo como color de marca, arcilla/coral como acento vivo y miel para destacar, sobre un
   marfil casi blanco. Se aleja del marrón actual sin caer en el morado/índigo genérico, y sigue
   siendo creíble para una app de interiores.

   | Token | Claro | Oscuro | Uso |
   |---|---|---|---|
   | `--bg` | `#faf8f4` | `#0f1615` | fondo de página |
   | `--surface` | `#ffffff` | `#172120` | tarjetas, paneles |
   | `--surface-2` | `#f1efe9` | `#1f2b2a` | fondos secundarios |
   | `--border` | `#e2ded5` | `#2f3d3b` | bordes |
   | `--text` | `#17201f` | `#edf2f0` | texto |
   | `--text-muted` | `#5a6664` | `#a3b1ae` | texto secundario |
   | `--primary` | `#0f5e5a` | `#5cc9bd` | marca, botones, enlaces |
   | `--primary-strong` | `#0a4744` | `#86dcd2` | hover, texto sobre `--primary-soft` |
   | `--primary-soft` | `#dcefec` | `#173532` | fondos tintados |
   | `--accent` | `#c24e24` | `#f08a63` | acento: cifras, subrayados, etiquetas |
   | `--accent-soft` (nuevo) | `#fbe6dc` | `#3a2218` | fondo del acento |
   | `--highlight` (nuevo) | `#e2a52a` | `#f0c25a` | solo decorativo (nunca texto) |

   Los valores son el punto de partida: la tarea 1 los fija con una prueba de contraste y se ajustan
   ahí si algún par no llega a 4.5:1.

2. **El color entra por los tokens, no por los componentes.** Se cambian valores en `:root` y en
   `dark-tokens`; los componentes siguen usando `var(--…)`. Los colores sueltos de interfaz se
   pasan a tokens en la misma tarea para que el cambio de paleta sea completo.

3. **Tokens nuevos que dan el "atractivo"** sin librerías: `--accent-soft`, `--highlight`,
   `--gradient-brand` (un solo degradado, para hero y cierre), `--tint-1…3` (fondos de sección
   alternos), `--ring` y una escala tipográfica (`--text-xs…--text-3xl`). Nada de sombras apiladas
   ni redondeo máximo en todo: se conservan `--radius-*` y `--shadow-*`.

4. **Tipografía autoalojada.** La CSP impide CDN, así que se añaden dos fuentes variables en
   `apps/web/public/fonts/` (woff2, subconjunto latino): **Fraunces** para títulos e **Inter** para
   texto, ambas con licencia OFL, con `font-display: swap` y `preload` solo de la de texto. Hoy los
   títulos caen en Georgia y el texto en la fuente del sistema.

5. **Más información = datos reales, no texto de relleno.** Las cifras de la landing salen del
   catálogo público y de `shared-types` (`STYLES`, `ROOM_TEMPLATES`, `ROOM_TYPE_LABELS`); las
   imágenes son capturas de la propia app. La lista de proyectos gana campos opcionales
   calculados en el servidor (área, estilos, total estimado), siguiendo la regla del proyecto:
   campos nuevos siempre opcionales.

6. **Movimiento sobrio.** Aparición al entrar en pantalla con `IntersectionObserver` (una directiva
   pequeña), transiciones de 150–250 ms y todo anulado bajo `prefers-reduced-motion` (ya existe la
   regla global).

7. **Seguimiento de tareas:** en `tasks/todo.md` (el proyecto no designa otro gestor).

## Grafo de dependencias

```
T1 tokens de color + prueba de contraste
 ├── T2 tipografía autoalojada + escala
 │     └── T3 clases base (botones, tarjetas, chips, secciones) + colores sueltos a tokens
 │           ├── T4 cabecera y pie
 │           ├── T5 landing: hero                ─┐
 │           ├── T6 landing: cifras y "qué reconoce" ├─ T9 landing: estilos, FAQ, cierre
 │           ├── T7 landing: galería de capturas  ─┘
 │           ├── T8 directiva de aparición (la usan T5–T9)
 │           ├── T10 entrar / registro
 │           ├── T12 mis proyectos (UI) ◄── T11 contrato + API de la lista
 │           ├── T13 asistente de proyecto nuevo
 │           └── T14 cabecera del proyecto, enlace público y 404
 └── T15 capturas, README, ADR, despliegue
```

T1 → T2 → T3 son secuenciales (todo depende de ellas). A partir de T3, la landing (T5–T9), el
acceso (T10), los proyectos (T11–T12) y el resto (T13–T14) son independientes entre sí.

## Lista de tareas

### Fase 1 — Cimientos (todo lo demás se apoya aquí)
- [ ] T1: Paleta nueva en los tokens, con prueba de contraste
- [ ] T2: Tipografía autoalojada y escala tipográfica
- [ ] T3: Clases base renovadas y colores sueltos a tokens

### Punto de control A
- [ ] Unitarias y lint en verde; suite e2e completa en verde (35/35) con la paleta nueva
- [ ] Capturas de `/`, `/entrar`, `/proyectos` y el editor en claro y oscuro, revisadas a ojo
- [ ] **Revisión del usuario: ¿esta es la paleta?** (es barato cambiarla aquí, caro después)

### Fase 2 — Landing
- [ ] T4: Cabecera y pie con más contenido
- [ ] T5: Hero con color y vista previa real
- [ ] T6: Franja de cifras y sección "qué reconoce de tu foto"
- [ ] T7: Galería de capturas por pestañas
- [ ] T8: Aparición al hacer scroll
- [ ] T9: Estilos, comparativa con foto / sin foto, FAQ ampliada y cierre

### Punto de control B
- [ ] `a11y.spec.ts` en verde en escritorio y `@mobile`; sin desbordes a 320, 768, 1024 y 1440 px
- [ ] Presupuesto de bundle inicial sin superar el aviso de 450 kB
- [ ] Revisión del usuario de la landing

### Fase 3 — Páginas de la app
- [ ] T10: Entrar y registro a dos columnas
- [ ] T11: La lista de proyectos trae área, estilos y total estimado
- [ ] T12: Mis proyectos: resumen, filtros y tarjetas con más datos
- [ ] T13: Asistente de proyecto nuevo con pasos visibles
- [ ] T14: Cabecera del proyecto, enlace público y 404

### Punto de control C
- [ ] Suite e2e completa en verde dos veces seguidas
- [ ] Flujo entero a mano: registro → proyecto nuevo → editor → compartir → enlace público

### Fase 4 — Cierre
- [ ] T15: Capturas, README, ADR-0017 y despliegue en Railway

### Punto de control final
- [ ] Todos los criterios cumplidos; humo y e2e contra la URL pública en verde

El detalle de cada tarea (criterios, verificación, archivos) está en `tasks/todo.md`.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La paleta nueva baja el contraste en algún par (sobre todo en oscuro) | Alto | T1 incluye una prueba que calcula el contraste WCAG de cada par texto/fondo leyendo `styles.scss`; axe en e2e como segunda red |
| Al usuario no le gusta la paleta una vez vista | Medio | Punto de control A antes de rediseñar páginas; como todo va por tokens, cambiarla son ~30 líneas |
| Las fuentes pesan y retrasan el primer pintado | Medio | Variables, subconjunto latino, `swap`, `preload` solo de una; tope de ~120 kB entre las dos |
| Más imágenes en la landing | Medio | JPG/WebP a un ancho máximo de 1600, `loading="lazy"`, `width`/`height` fijos para no mover el diseño |
| Pruebas e2e que buscan textos o roles que cambian | Medio | No se renombran botones ni títulos que las specs usan (`Diseñar mi cuarto`, `Mis proyectos`, `Recorrer`…); si un texto cambia, se cambia la spec en la misma tarea |
| Cambiar el contrato de la lista rompe clientes viejos | Bajo | Campos opcionales; el servidor los calcula, no hay migración |
| El cromado del editor queda raro con la paleta nueva | Medio | T3 revisa sus colores sueltos; captura del editor en el punto de control A |
| El rediseño acaba con "pinta de plantilla" | Medio | Un solo degradado, radios y sombras actuales, contenido real; revisión contra la tabla de vicios del skill de frontend |

## Preguntas abiertas

1. **Paleta.** Se propone "Petróleo y arcilla". Alternativas ya pensadas, por si prefieres otra:
   - *Tinta y ámbar*: azul tinta `#1f3a5f` + ámbar `#d98a1e` — más seria, más "arquitectura".
   - *Oliva y terracota*: verde oliva `#55652f` + terracota `#b8502e` — más cálida, la más cercana a la actual.
   Si no dices nada, se ejecuta la recomendada y se revisa en el punto de control A.
2. **Fuentes.** ¿Vale Fraunces + Inter autoalojadas, o prefieres seguir con las del sistema (cero peso)?
3. **Total estimado en la tarjeta del proyecto.** ¿Quieres que se vea el costo en la lista, o solo dentro del proyecto?
4. **Despliegue.** La aprobación del plan v5 autorizó desplegar en Railway; ¿sigue valiendo para este rediseño (T15)?
