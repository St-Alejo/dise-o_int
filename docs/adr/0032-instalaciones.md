# ADR-0032: Instalaciones eléctricas e hidrosanitarias (fase 4 del plan v8)

**Estado:** aceptada · **Fecha:** 2026-11-01

## Contexto
Un juego de planos para obra necesita dónde van las tomas, los interruptores, las salidas de luz y
los puntos de agua, cómo se agrupan en circuitos y si cumplen lo básico del RETIE / NTC 2050. La
ficha técnica ya tenía `installations` (puntos y circuitos) desde la fase 0, sin nada que la llenara.

## Decisión
- **Punto en pared o en planta** (`shared-types/src/pro/installations/points.ts`): cada punto va en
  una pared (`wallId` + `offsetM` desde su inicio, a `heightM`) o, si es una luz o una rejilla, en un
  punto de la planta. `INSTALLATION_INFO` da la altura típica, la carga de diseño (180 VA por toma,
  100 VA por luz) y la abreviatura del símbolo.
- **Propuesta automática** (`propose.ts`): luz por cada luminaria de techo (o una al centro), un
  interruptor del lado de la chapa a 1,20 m que enciende esas luces, tomas junto a mesas de noche,
  escritorio, mueble de TV (con salida de datos), nevera y cocina, tomas por el perímetro cada
  1,8 m como máximo evitando puertas, GFCI cerca del agua y los puntos de agua fría, caliente y
  desagüe de cada aparato a su altura normalizada. Lo propuesto lleva `auto: true` y se regenera;
  lo puesto a mano se respeta.
- **Circuitos** (`circuits.ts`): iluminación 15 A, tomas 20 A, zonas húmedas 20 A y dedicados 30 A
  (≥ 1 000 W), sin pasar del 80 % del interruptor ni de 12 salidas. El interruptor va al circuito de
  su luz. **Cuadro de cargas** con demanda NTC 2050 220-11 (3 000 VA al 100 % y el resto al 35 %),
  calibre AWG y totalizador sugerido.
- **Planos** (`plan-symbols.ts`, patrón Factory por tipo de punto): láminas "Plano eléctrico" y
  "Plano hidrosanitario" (solo si hay puntos de esa familia) con símbolos, etiqueta de altura y
  circuito, líneas de mando punteadas interruptor → luz y leyenda; capas `E-POWR`, `E-LITE` y
  `P-SANR` en el DXF.
- **Normativa**: grupo nuevo "Instalaciones eléctricas" en el motor de reglas (Specification):
  tomas cada 1,8 m por el perímetro, GFCI a menos de 1,8 m del agua, interruptor junto a cada puerta
  y carga de cada circuito. Sin puntos, las reglas salen como "no aplica" y piden proponerlos.
- **Cómputo**: los puntos entran al presupuesto de obra como "punto eléctrico" y "punto
  hidrosanitario" (ya previsto en la fase 3).
- **Web**: bloque "Instalaciones" en la pestaña Pro (proponer, quitar la propuesta, borrar o añadir
  puntos a mano, cuadro de cargas); todo se guarda en la ficha con `setTechnical`.

## Consecuencias
- Es orientativo: el diseño eléctrico definitivo lo firma un profesional con matrícula.
- Los puntos se editan desde el panel, no arrastrándolos en el plano, y no se ven como marcadores
  en el 3D (queda anotado en `tasks/todo.md`).
- 120 V monofásico fijo por defecto (editable en la ficha); no hay cálculo de caída de tensión.
