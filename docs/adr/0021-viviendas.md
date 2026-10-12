# ADR-0021 — Viviendas: varios cuartos juntos, sin cambiar qué es un proyecto

**Estado:** aceptada · **Fecha:** 2026-10-11

## Contexto
Hasta ahora un proyecto era un cuarto. Se pidió poder trabajar una vivienda entera: varios cuartos
que se ven juntos, con sus totales.

El plan proponía una tabla `Room` (un proyecto con muchos cuartos) y rutas
`/projects/:id/rooms/:roomId/...`. Eso obliga a mover a la tabla nueva la planta, los muebles, los
acabados, la foto y la revisión, y a rehacer sobre ella el editor, las versiones, los enlaces
compartidos, el pipeline de IA, el PDF y la demo. Es una migración de datos con riesgo real sobre
una base en producción, y un cambio que toca casi todos los módulos a la vez.

## Decisión
Una vivienda **no es una entidad nueva**: son los cuartos de una misma persona que comparten
`homeId`, con un `homeName`. Cada cuarto sigue siendo un proyecto, con todo lo que ya tiene (editor,
versiones, compartir, exportar).

- **Base de datos:** dos columnas opcionales en `projects` y un índice. Aditivo: lo que existía no
  cambia y un cuarto sin vivienda sigue siendo un proyecto suelto.
- **API:** `PUT /projects/:id/home` crea la vivienda desde un cuarto, la renombra (para todos sus
  cuartos), mete un cuarto en una existente o lo saca. `POST /projects` acepta `homeId`. Solo se
  entra en viviendas propias. El proyecto devuelve `home` con sus cuartos; la lista, `homeId` y
  `homeName`.
- **Web:** en "Mis proyectos", una sección de viviendas con el número de cuartos, la superficie, las
  piezas y el total, y accesos a cada cuarto. En cada cuarto, una barra con sus compañeros y
  "Añadir cuarto", que abre el asistente con la vivienda ya elegida.

## Qué no hace (y era parte de lo pedido)
- La planta conjunta llegó después (ADR-0022): los cuartos se colocan unos junto a otros y se
  guarda dónde va cada uno. Siguen sin puertas compartidas y no se camina de uno a otro.
- El PDF y la presentación siguen siendo por cuarto; no hay un dossier de la vivienda entera.
- Las versiones y los enlaces compartidos son de cada cuarto.

## Consecuencias
- Si más adelante se quiere la planta conjunta, `homeId` es el punto de partida: bastaría guardar la
  posición de cada cuarto en la vivienda, sin deshacer nada de esto.
- Renombrar una vivienda son tantas escrituras como cuartos tenga (pocas).
- Borrar el último cuarto de una vivienda la hace desaparecer: no queda nada huérfano.
