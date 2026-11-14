# ADR-0038: Rediseño "Lino y nogal": la portada como escenario partido

**Estado:** aceptada · **Fecha:** 2026-11-14 · **Sustituye:** la paleta y la tipografía de ADR-0017 y la portada de ADR-0020

## Contexto
La app compartía recursos con Plano 3D (el otro proyecto del curso): la misma serif (Fraunces), un
color petróleo parecido y un hero fijo con fundido, que es justo el recurso de la portada de Plano 3D.
Se pidió un rediseño completo que se viera más profesional y que no se pareciera al otro proyecto.

## Decisión
- **Marca "Lino y nogal".** Fondo lino `#efeae2`, tinta nogal `#231c17`, acento verde salvia
  `#3f5b4a` y latón oscuro `#7a5520`; modo oscuro "sala de noche". Mismos nombres de token en
  `styles.scss`, así que el resto de la app cambia sin tocar componentes; `design-tokens.spec.ts`
  sigue exigiendo AA en cada pareja.
- **Tipografía de revista, autoalojada:** Instrument Serif (solo 400, romana y cursiva, sin negrita
  sintética) para titulares y Figtree variable para la interfaz. Fraunces e Inter pasan a
  `public/fonts/_old/`.
- **Portada en escenario partido**, no un hero a pantalla completa: a la izquierda se lee y a la
  derecha queda fija *la misma sala de 5 × 4,2 m* renderizada en Blender en cada uno de los seis
  estilos (`landing/vida-*.webp`). Al bajar por los estilos la foto cambia; cada estilo trae su
  paleta, tres piezas reales del catálogo con precio y una foto de referencia. En el celular no hay
  mitad fija: cada estilo lleva su propia foto.
- **El resto en piezas propias** (`how`, `vitrina`, carta del Modo Pro, cifras como líneas de
  revista, preguntas en texto corrido), sin eyebrows, sin tarjetas con icono y sin sombras en reposo.
- Las pantallas de entrar, registro, proyectos, plantillas y 404 adoptan el mismo escenario partido.

## Consecuencias
- Las imágenes `vida-*` salen de la propia app (estudio → Blender, vista Esquina, 2K «Buena»); si
  cambia el catálogo se rehacen con `e2e/tests/zz-redesign-renders.spec.ts` (fuera de git).
- El hero y el mosaico anteriores quedan en `apps/web/_old/home/` por si hay que volver atrás.
- axe AA pasa en claro y oscuro, escritorio y celular; el bundle inicial sigue en ~334 kB.
