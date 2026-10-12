# ADR-0020 — Página de inicio editorial

**Estado:** aceptada · **Fecha:** 2026-10-11 · Sustituye la parte de "página de inicio" del ADR-0017

## Contexto
La página de inicio rehecha en el ADR-0017 tenía mejor color y tipografía, pero seguía viéndose
pobre. Dos causas: las imágenes eran renders de cuartos casi vacíos y con luz plana, y la página
era una pila de diez secciones del mismo peso, todas en tarjetas sobre fondos alternos.

Se revisaron páginas del sector (Planner 5D, Floorplanner, Arcadium, Rayon, Spacely, Interior AI,
Havenly y el caso de estudio de Archime). Lo que se repite en las que funcionan: enseñar primero el
resultado y explicar después, una idea por sección, imagen grande, un antes y después, y una forma
de probar sin registrarse.

## Decisión
- **Primero la imagen.** Antes de tocar la maquetación se mejoró lo que se fotografía (ADR-0018 y
  ADR-0019). Todo lo que enseña la página sigue siendo la app real.
- **Tono editorial cálido.** Marfil como fondo único y una sola sección profunda (el cierre, en
  petróleo). Fuera los fondos alternos y las tarjetas: aire y filetes finos. Titulares en Fraunces
  con una frase en cursiva; el del encabezado, en tamaño de exhibición con escala fluida.
- **Ocho secciones, una idea cada una:** encabezado con el cuarto a todo el ancho y conmutador de
  luz; tres pasos sobre un filete; antes y después con deslizador; el editor en capturas; estilos
  por pestañas con la misma sala en cada uno; mosaico de plantillas; qué reconoce de una foto y qué
  estima, con las cifras; preguntas y cierre.
- **Dos acciones:** "Diseñar mi cuarto" y "Probar sin cuenta", que abre la plantilla de la imagen.
- **Imágenes reproducibles.** `playwright.shots.config.ts` captura el visor en calidad alta y
  `scripts/landing-images.py` recorta y convierte a WebP en dos anchos (`srcset`).
- **Tokens nuevos** en `styles.scss`: `--deep`, `--on-deep`, `--on-deep-muted`, `--rule`,
  `--text-display`, `--section-y`; y las clases `.editorial`, `.display`, `.title-xl`, `.spread`,
  `.rule`, `.deep` y `.arrow-link`. La prueba de contraste cubre el texto sobre la sección profunda.

## Desviaciones respecto del plan
- **El antes y después compara el cuarto vacío con el amueblado**, no una foto con su 3D: con el
  analizador de prueba no hay una pareja foto/resultado que enseñar con honestidad.
- **Fotos de terceros, solo en los estilos.** Todo lo demás sale de la app. En la sección de
  estilos, cada cuarto dibujado lleva al lado una foto CC0 de una casa real de ese estilo
  (añadidas después: ver ADR-0022 y `apps/web/public/landing/fotos/ATTRIBUTION.md`).
- **La cabecera no se vuelve transparente** sobre el encabezado: se mantiene sólida.

## Consecuencias
- Para una sección nueva: `<section class="editorial">` con un `.spread` (etiqueta y titular) y
  `appReveal` en su contenedor.
- Si el editor o el visor cambian de aspecto, las imágenes se rehacen con dos comandos.
- Las cifras del catálogo son modestas a propósito: se enseñan como dato, no como reclamo.
