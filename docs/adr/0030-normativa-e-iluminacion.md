# ADR-0030: Revisión normativa y cálculo de iluminación (fase 2 del plan v8)

**Estado:** aceptada · **Fecha:** 2026-11-01

## Contexto
Un profesional necesita saber si el cuarto cumple antes de llevarlo a obra: pasos, puertas,
altura libre, luz y ventilación, holguras de uso y cuánta luz dan las lámparas. La revisión del
diseño que ya existía (`design-check.ts`) responde a "¿se puede usar?", no a "¿cumple tal criterio?".

## Decisión
- **Reglas como Specification** (`shared-types/src/pro/compliance/rules.ts`): cada regla dice si
  aplica y devuelve hallazgos con estado (cumple, aviso, no cumple, no aplica), lo medido, lo
  exigido y la fuente. El motor (`check.ts`) arma el contexto una vez y recorre las reglas.
- **Perfiles = datos, no código** (`profiles.ts`): "Buenas prácticas (Neufert)" y "Colombia —
  orientativo" (NSR-10/POT, NTC 6047, RETILAP) son juegos de números. Añadir un país es añadir un
  objeto. El informe dice siempre que es orientativo.
- **Reglas:** paso libre desde la puerta (rejilla de 10 cm y un círculo del ancho de paso, con el
  mismo mundo del recorrido a pie), vano de puertas (también las de zonas), giro Ø 1,50 m si el
  proyecto es accesible, altura libre, iluminación y ventilación natural por área de ventana,
  holguras delante de aparatos y muebles (rectángulo que crece desde su frente, +z local, hasta
  chocar), lados de la cama, triángulo de cocina, alturas de trabajo, iluminancia media y
  uniformidad, factor de luz diurna.
- **Iluminación punto a punto** (`lighting-calc.ts`): fuentes puntuales con lúmenes por
  subcategoría; de techo con distribución cos^n (Lambertiana, focos más cerrados), de pie/mesa/pared
  omnidireccionales; componente reflejada por el método del flujo total; factor de mantenimiento
  0,8; banda de 0,5 m sin evaluar (EN 12464-1).
- **Luz natural:** factor de luz diurna medio con la fórmula de la BRE, repartido por la planta según
  la distancia a cada ventana, por la iluminancia exterior de cielo cubierto a la hora elegida.
- **Dónde corre:** en el navegador (instantáneo, con lo que hay en pantalla) y en la API
  (`GET /projects/:id/compliance`, `/compliance.pdf`) con el mismo código.
- **Integración:** sección "Normativa y ergonomía" en la pestaña Pro con mapa de calor de noche y de
  día; lo que no cumple aparece también en la revisión del diseño y lleva al mueble.

## Consecuencias
- Sin sombras de muebles ni rebotes reales: es un predimensionado, no un DIALux.
- Los lúmenes son por subcategoría, no un atributo de cada producto del catálogo (desviación del
  plan: el catálogo no trae ese dato). Se puede añadir sin cambiar el cálculo.
- Las zonas cerradas (baño privado) no se evalúan en la rejilla de luz del cuarto.
- Las reglas eléctricas (RETIE) llegan con las instalaciones (fase 4).
