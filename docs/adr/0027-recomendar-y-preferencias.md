# ADR-0027: Recomendar con lo fijado y aprender de los gestos (fases 4 y 5 del plan v7)

**Estado:** aceptada · **Fecha:** 2026-10-21

## Contexto
"Otra distribución" solo movía muebles. El usuario pidió un botón **Recomendar** con estas
condiciones:
- que proponga estilo, colores, acabados, luz y muebles;
- que respete lo fijado: si pidió "piso de baldosa brillante azul claro con verde", ese piso sigue
  en todas las propuestas;
- que aprenda qué le gusta.

## Decisión
- **Propuestas puras (`packages/shared-types/src/recommend.ts`, `palette.ts`).**
  - Con una semilla se genera una propuesta entera:
    - un estilo no fijado, sin repetir los tres últimos;
    - una paleta por armonía (análoga, complementaria o triádica) a partir de lo fijado o del
      estilo;
    - acabados compatibles solo en las superficies sin candado;
    - la luz.
  - Cada propuesta lleva sus rasgos numéricos: estilo one-hot, calidez y contraste de la paleta,
    tipo de piso, luz.
  - `priorScore` es la nota de oficio: contraste moderado y piso y luz típicos del estilo.
- **API.**
  - `POST /projects/:id/recommend { seed?, intensity }` arma 6 candidatas, elige una y guarda los
    acabados y el estilo (revisión nueva).
  - Con `total` también encola la distribución, con la semilla y las piezas fijadas a mano en su
    sitio.
  - Cada propuesta queda en `recommendation_feedback` como `shown`.
  - 👍, 👎, "me la quedo" y "deshacer" (`POST …/recommendations/:rid/feedback`) se guardan con los
    rasgos de la propuesta.
- **Elegir con lo aprendido.**
  - Se envían al servicio de IA las candidatas y los últimos 200 gestos de la persona, de todos sus
    proyectos (`/v1/recommend/rank`).
  - Con al menos 6 gestos que tengan positivos y negativos, el servicio entrena una regresión
    logística sobre los rasgos. Pesos: "me la quedo" 1,5; 👍 1; deshacer −0,75; 👎 −1. Puntúa
    cada candidata con su probabilidad de gustar.
  - Con menos gestos, el servicio devuelve la nota de oficio. Entonces la API usa
    `preferenceScore` (TS): el prior más el producto de los rasgos centrados por el gusto
    acumulado, que ya aprovecha 1 o 2 gestos.
  - Si el servicio falla, también se usa `preferenceScore`. Recomendar nunca depende de la IA.
- **Web.**
  - El botón ✨ Recomendar y "Solo colores y luz" (intensidad `suave`).
  - Una tarjeta con la propuesta, su paleta, 👍/👎, Deshacer, Otra y Me la quedo.
  - El panel "Lo que pediste" muestra el Brief como chips con candado.
  - Deshacer devuelve el estado anterior en un paso, y cuenta como gesto negativo.
- **El chat también recomienda.** "Recomiéndame algo bohemio" fija el estilo y pide una propuesta
  total. Una imagen de referencia fija lo leído y pide otra.

## Consecuencias
- Lo fijado no cambia nunca: lo comprueba el E2E `recommend.spec.ts`, con tres propuestas
  seguidas.
- El aprendizaje es por persona y simple: pocos rasgos y un modelo lineal. Es explicable y entrena
  en milisegundos en cada petición, pero no capta combinaciones ("me gusta la madera, pero solo con
  luz cálida").
- Los gestos son datos personales mínimos: rasgos numéricos y el estilo, nunca la foto. Se borran
  con el proyecto (FK en cascada).
