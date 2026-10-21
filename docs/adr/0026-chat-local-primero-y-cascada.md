# ADR-0026: Chat con modelo propio primero, Groq después y reglas al final (fase 5 del plan v7)

**Estado:** aceptada · **Fecha:** 2026-10-21

## Contexto
Hasta la v6 el chat tenía dos agentes: Claude (con clave) o un agente por reglas.

Las reglas solo entendían frases con una forma fija. Por eso "quiero el piso de baldosa brillante,
color azul claro con verde" no hacía nada. Claude sí lo entiende, pero cuesta dinero y depende de
la red en cada mensaje.

El usuario pidió dos cosas:
- gastar menos IA externa;
- que el chat ponga pisos, baldosas, luces y zonas, y que pueda replicar una imagen.

## Decisión
- **Modelo de intención propio (`services/ai/ml/`).**
  - Es un clasificador TF-IDF de n-gramas de caracteres (2–5) y de palabras (1–2) con
    `LogisticRegression`, sobre 17 intenciones.
  - Los n-gramas de caracteres aguantan faltas de ortografía ("baldoza"). Los de palabras
    distinguen "quita la alfombra" de "sin alfombras".
  - Se entrena con unas 15 000 frases en español generadas con plantillas y sinónimos
    (`dataset.py`).
  - El entrenamiento se hace al construir la imagen (unos 10 s), así que no se versiona ningún
    binario.
  - F1 macro: ≥ 0,99 en validación generada y ≥ 0,9 en 48 frases escritas a mano.
- **Parámetros deterministas (`slots.py`).** Un léxico extrae colores en español a #hex (con
  matices: "azul claro", "rojo clarito"), material, dibujo, brillo, tamaño de pieza, altura de
  revestimiento, cantidad, estilo, luz, zona y tipo de baño.
- **Herramientas nuevas de la `DesignToolbox`.**
  - `set_finish_spec` es un acabado propio descrito con palabras. Lo pedido queda fijado en el
    Brief.
  - También `set_wall_tiles`, `set_lighting`, `pin`/`unpin`, `want_item`, `add_zone` (baño
    privado) y `recommend`.
  - Salen operaciones nuevas `zones`, `brief` y `recommend`, en orden fijo: room, zones, finishes,
    brief, remove, add, update, recommend.
- **Cascada en `ChatService`.** Los agentes se prueban en este orden: local, Groq, Claude, reglas.
  - **Local (`LocalNluDesignAgent`).**
    - Separa el mensaje en órdenes. Una coma sola no corta, y "paredes verdes y el piso de nogal"
      cuenta como dos órdenes.
    - Pide la intención de cada orden a `/v1/nlu/parse`.
    - Con confianza ≥ 0,75 (`NLU_MIN_CONFIDENCE`) y los parámetros completos, aplica las
      herramientas.
    - Los muebles y las medidas los resuelve la sesión de reglas, que ya sabe de catálogo y
      relaciones espaciales.
    - Si una sola orden queda en duda, lanza `AgentDeclinedError`. No se toca nada y responde el
      siguiente.
    - No gasta cuota.
  - **Groq (`GroqDesignAgent`).**
    - Usa chat completions compatible con OpenAI y las mismas herramientas, convertidas a JSON
      Schema.
    - No reintenta ante 429.
    - Tiene un cortacircuitos propio: tres fallos seguidos y descansa 60 s.
    - Gasta la cuota diaria del chat y la devuelve si falla.
  - **Claude:** sigue disponible si hay `ANTHROPIC_API_KEY`.
  - **Reglas:** siempre responden. Si un LLM falló, avisan.
- **Imagen de referencia (`POST /projects/:id/chat/reference`).**
  - La foto se normaliza como las del cuarto, sin EXIF, y se guarda en `projects/:id/refs/` (se
    borra con el proyecto).
  - `/v1/reference/analyze` la lee con la visión de Groq, con caché por hash y la cuota
    `VISION_PER_DAY`.
  - Sin visión, la lee con k-means en Lab: el piso sale de la franja de abajo y las paredes de la
    de arriba.
  - Lo leído se fija en el Brief: piso, color de paredes, estilo y luz. Después se pide Recomendar
    total, así que "replicar" se adapta a la geometría del cuarto real en vez de copiar la foto.
- **`CHAT_LLM=off`** deja solo el modelo propio y las reglas. Las pruebas E2E lo usan para ser
  deterministas y no gastar cuota.
- **Web.**
  - Se puede adjuntar, pegar o soltar una imagen en el chat.
  - Aparece una etiqueta de quién respondió (Local, Groq, IA, Básico).
  - El Brief se guarda aparte y no entra en el Ctrl+Z del mensaje. Los cambios de escena sí siguen
    siendo un solo paso.

## Consecuencias
- La mayoría de los pedidos de acabados, luz, estilo y muebles se resuelven sin LLM, en
  milisegundos. Groq queda para lo que el modelo no entiende.
- Un pedido con dos intenciones mezcladas en una sola orden ("piso azul que combine con el sofá")
  puede ir a Groq aunque una parte fuera local. Es preferible a aplicarlo a medias.
- El dataset generado es la parte débil: frases muy distintas a las plantillas bajan la confianza.
  Siguiente paso: guardar las frases que terminan en Groq, revisarlas y sumarlas al entrenamiento.
- Que la visión de Groq lea bien una foto depende del modelo y de su cuota. El respaldo por
  colores siempre responde, con menos detalle (sin objetos ni estilo seguro).
