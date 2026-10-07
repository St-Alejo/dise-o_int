# ADR-0009 — Chat de diseño: herramientas, resolvedor espacial y operaciones deshacibles

**Estado:** aceptada · **Fecha:** 2026-10-07

## Contexto
Queremos amueblar el cuarto conversando ("pon una lámpara de pie junto al sofá", "pinta las paredes de
verde"). Un LLM es bueno entendiendo la intención y eligiendo piezas, pero malo calculando
coordenadas que respeten paredes, puertas, ventanas, alturas y colisiones. Además el chat tiene que
funcionar sin API key (demo, CI, sin costo) y no puede dejar la escena a medias si algo falla.

## Decisión
- **El modelo no calcula coordenadas.** Expresa relaciones (`next-to`, `left-of`, `in-front-of`,
  `facing`, `on-top-of`, `above`, `against-wall`, `center`, `anywhere`…). El **`SpatialResolver`**
  (`shared-types`) es determinista: las convierte en poses válidas con la misma colisión 3D por capas
  del editor, o devuelve el motivo en español ("No cabe junto a la Cama…"), que vuelve al modelo como
  `tool_result` con `is_error` para que pruebe otra cosa.
- **`DesignToolbox` (Facade)** sobre una copia virtual de la escena: `search_catalog`, `get_scene`,
  `list_materials`, `add_item`, `move_item`, `rotate_item`, `resize_item`, `remove_item`,
  `set_material`, `set_finishes`, `set_room_size`. Cada entrada se valida con zod. Al terminar,
  `operations()` devuelve la **diferencia** entre la escena original y la final (`room`, `finishes`,
  `remove`, `add`, `update`): lo agregado y luego quitado no aparece.
- **Puerto `DesignAgent` (Strategy)** con dos adaptadores que usan la misma toolbox:
  - `ClaudeDesignAgent`: bucle manual de tool use con `@anthropic-ai/sdk`; modelo por `CHAT_MODEL`
    (por defecto `claude-opus-5-5`), pensamiento adaptativo, `effort: medium`, herramientas `strict`
    derivadas de los schemas zod (sin las palabras clave que strict no admite), `fallbacks: "default"`
    ante rechazos de seguridad, y tope de vueltas (`CHAT_MAX_TOOL_TURNS`).
  - `RuleBasedDesignAgent`: intérprete en español sin red (verbos, cantidades, pronombres, relaciones,
    colores y materiales, medidas del cuarto). Respaldo sin key, ante fallos de la API o con la cuota
    agotada, y base de las pruebas E2E deterministas.
- **El servidor no guarda.** `POST /projects/:id/chat` responde `{reply, operations, agent}`. La web las
  aplica como **un `MacroCommand`** ("Cambios del asistente"): un Ctrl+Z deshace todo el mensaje y el
  guardado es el de cualquier edición (misma validación del servidor, misma revisión optimista).
- **Costo y abuso:** throttle de 20 mensajes/min, cuota diaria `CHAT_PER_DAY` (Redis, Template Method
  sobre `RedisQuota`) que se devuelve si Claude falla, corte de la llamada si el cliente cierra la
  conexión, la escena se envía resumida (ids, nombres, medidas) y nunca datos personales.

## Consecuencias
- Cambiar de modelo o de proveedor es otro adaptador del puerto; la geometría no cambia.
- El agente por reglas entiende frases simples; lo amplio ("hazlo más acogedor") necesita Claude.
- Un cambio de medidas del cuarto pedido por chat se aplica en el servidor primero (`PUT /room`) y,
  como en el editor, no se deshace con Ctrl+Z.
- Para Claude real hay que definir `ANTHROPIC_API_KEY` (opcional; sin ella responde el asistente básico).
