# Gasto en Claude (tope de la demo)

Presupuesto total: **US$2**, repartido en US$1 para Plano 3D (`PLANO3D_CLAUDE_BUDGET_USD`) y US$1 para Interiores (`CLAUDE_BUDGET_USD`).

## Interiores

- **Modelo del chat:** `CHAT_MODEL=claude-sonnet-5-5`. Cuesta US$2 por millón de tokens de entrada y US$10 por millón de salida; la caché se lee a US$0,10.
- **Contador:** cada respuesta suma su costo real (`usage`) en Redis, en la clave `spend:claude:usd`. Al llegar al tope, el chat deja de llamar a Claude y sigue con el modelo local y las reglas.
- **Ver el gasto:** `docker compose exec redis redis-cli GET spend:claude:usd`.
- **Reiniciarlo:** `DEL spend:claude:usd`, solo si se decide gastar más.

| Fecha | App | Qué se probó | Gasto acumulado (US$) |
|---|---|---|---|
