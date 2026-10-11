# ADR-0017 — Sistema visual: paleta, tipografía y páginas con más contenido

**Estado:** aceptada · **Fecha:** 2026-10-11

## Contexto
La web funcionaba pero se veía apagada. Toda la interfaz vivía en una gama de beige y marrón, el
color de acento casi no se usaba, los títulos caían en Georgia y el texto en la fuente del sistema.
La página de inicio contaba poco de lo que la app ya hace, y las páginas internas eran listas
planas: la tarjeta de un proyecto solo decía su nombre, su tipo y cuántos muebles tenía.

## Decisión
**Color**
- **Paleta "petróleo y arcilla".** Verde petróleo de marca, arcilla como acento y miel para
  resaltar, sobre marfil; con su versión oscura. Se aleja del marrón sin caer en el morado genérico.
- **El color entra por los tokens.** Solo cambian los valores de `:root` y de `dark-tokens` en
  `styles.scss`; los componentes siguen usando `var(--…)`. Cambiar de paleta son unas treinta líneas.
- **El contraste se prueba.** `design-tokens.spec.ts` lee `styles.scss` y exige 4.5:1 en cada
  pareja de texto y fondo y 3:1 para el anillo de foco, en los dos temas.
- **Tokens nuevos:** `--accent-strong`, `--accent-soft`, `--highlight` (solo decorativo),
  `--tint-1…3` (fondos de sección alternos), `--gradient-brand` (el único degradado: encabezado y
  cierre) y `--ring`.

**Tipografía**
- **Fraunces** para títulos e **Inter** para texto, variables y con subconjunto latino (85 kB entre
  las dos), servidas desde `/fonts` porque la CSP no admite fuentes externas. Licencia OFL.
- Escala `--text-xs…--text-3xl`; solo la fuente de texto se precarga.

**Contenido con datos reales**
- **Página de inicio:** el encabezado enseña el plano interactivo junto a un cuarto de esa forma ya
  amueblado; una franja de cifras leídas del catálogo público; qué reconoce la app en una foto y
  qué solo estima; galería por pestañas con capturas reales; comparativa con foto / sin foto;
  estilos que abren el asistente con ese estilo; ocho preguntas frecuentes.
- **Mis proyectos:** resumen, filtro por tipo de cuarto, orden y tarjetas con área, total estimado
  y estilo. `ProjectListItem` gana `areaM2`, `outline`, `styleId`, `estimatedTotal` y `currency`,
  todos opcionales y calculados al leer (sin migración, una sola consulta al catálogo por lista).
  Sin miniatura, la tarjeta dibuja la planta del cuarto a escala.
- **Proyecto y enlace público:** una franja con superficie, medidas, alto, muebles y total, leída
  del estado vivo del editor.

**Movimiento**
- La directiva `appReveal` hace aparecer las secciones al entrar en pantalla poniendo y quitando
  una clase. Lo que ya está a la vista, los navegadores sin `IntersectionObserver` y quien pide
  menos movimiento ven el contenido desde el principio.

## Consecuencias
- Para añadir un color: un token en `:root`, su versión en `dark-tokens` y, si lleva texto encima,
  su pareja en `design-tokens.spec.ts`.
- Para añadir una sección a la página de inicio: `<section class="section">` (con `section-tint`
  si alterna fondo), un `.section-head` y `appReveal` en su contenedor.
- Los colores de materiales, luces y planos exportados siguen escritos a mano: son del cuarto, no
  de la interfaz.
- Las capturas de la página de inicio son archivos: si la interfaz cambia, hay que rehacerlas.
- El estilo de la tarjeta es el elegido en las propuestas; un cuarto que mezcla varios no lo muestra.
- La tarjeta del proyecto sigue en `projects.page.ts`; solo se extrajo su lógica de filtrado.
