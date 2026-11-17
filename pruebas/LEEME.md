# Fotos de prueba para Interiores

Fotos de cuartos para subir en **Nuevo proyecto → Desde una foto**, o adjuntas en el chat de
diseño. La IA las convierte en un cuarto 3D y después se estilizan: estilo, muebles, televisor,
acabados y render.

Cada foto se pasó por el analizador de visión (Groq, `qwen/qwen3.8-27b`, el mismo prompt de
producción). Lo que entendió está en `analisis/<foto>.json`. Para repetirlo, desde la raíz del
repo:

```
python services/ai/scripts/probe_vision.py --fotos pruebas/fotos --salida pruebas/analisis
```

El script no vuelve a llamar a la API por una foto que ya tiene su `.json`.

## Las fotos y lo que entendió la IA

| Foto | Tipo | Medidas (m) | Aberturas | Muebles detectados | Para probar |
|---|---|---|---|---|---|
| `habitacion-vacia.jpg` | alcoba | 4,2 × 5,5 × 2,6 | ventana izq., ventana al fondo, puerta der. | ventilador de techo | **Cuarto vacío**: amoblar desde cero («hazla alcoba juvenil con TV») |
| `sala-vacia-cocina-abierta.jpg` | cocina/sala | 5,5 × 4,5 × 2,7 | ventanal y puerta-balcón a la izq. | nevera, lavaplatos, horno, gabinetes | **Apartamento vacío**: amoblar la sala, «coloca una tele» |
| `sala.jpg` | sala | 5,5 × 4,5 × 2,7 | ventanal der. | sofá, mueble de TV, TV, mesa de centro, alfombra, lámpara, cuadro | Cambiar de estilo y conservar la TV |
| `sala-abierta.jpg` | sala | 5,5 × 7,5 × 2,7 | puerta al fondo | sofá, mesa de centro, alfombra, comedor con 4 sillas, cuadro, lámpara, planta | Sala-comedor abierta |
| `comedor.jpg` | comedor | 5,5 × 4,5 × 2,7 | ventanales der., fondo e izq. | mesa, sillas, sofá, lámpara | Mucha luz; estilo escandinavo |
| `cocina.jpg` | cocina | 4,5 × 5,5 × 2,7 | ventana y puerta der. | isla, taburetes, nevera, gabinetes en 3 paredes, planta | Cocina con isla |
| `cocina-blanca-isla.jpg` | cocina | 3,5 × 4,5 × 2,7 | puerta der. | nevera, isla, comedor, lámpara | Cocina blanca moderna |
| `dormitorio.jpg` | alcoba | 3,5 × 4,5 × 2,5 | puerta der. | cama, mesitas, cuadro, lámpara | Pared vinotinto: la IA conserva el color |
| `dormitorio-moderno.jpg` | alcoba | 4,2 × 5,5 × 2,8 | puerta der. | cama, mesitas, alfombra, cuadro, lámpara, repisa | Alcoba principal |
| `dormitorio-ventanal.jpg` | alcoba | 3,6 × 4,2 × 2,8 | ventanal izq. | cama, alfombra, lámpara, cuadro, planta | Alcoba con vista |
| `oficina.jpg` | estudio | 4,5 × 5,0 × 2,7 | ventanal der. | escritorio, sillas, estanterías, mesa baja, planta, cuadros, lámpara | Pared azul |
| `estudio-ventanal.jpg` | estudio | 3,5 × 4,0 × 2,8 | ventanales al fondo y der. | escritorio, silla, computador | Estudio pequeño |
| `bano-blanco.jpg` | baño | 2,0 × 3,0 × 2,4 | — | sanitario, lavamanos, tina, toallero, planta | Baño (piso de baldosa) |

**Qué esperar:**
- El tipo de cuarto, en qué pared está cada abertura, el inventario de muebles y el color de las
  paredes salen bien en todas.
- Las medidas son aproximadas, redondeadas a medio metro. Por eso la pantalla de confirmación
  pide una medida ancla.
- La forma sale casi siempre rectangular: una sola foto no muestra la planta. Una sala en L se
  corrige en el plano.

Ideas para el chat después de crear el cuarto:
- «coloca una tele de 65 en la pared del fondo»
- «estilo industrial»
- «agrega un sofá en L y una alfombra»
- «piso de madera clara»
- «renderiza la sala al atardecer»

## Origen y licencias

**Pexels** (licencia Pexels: uso libre, sin atribución obligatoria). Son las fotos de
`e2e/fixtures/rooms/`; los enlaces a cada original están en `e2e/fixtures/rooms/FUENTES.md`.
- `sala`, `dormitorio`, `comedor`, `oficina`, `cocina` y `sala-abierta`.

**rawpixel**, dominio público (CC0), redimensionadas a 1024 px y convertidas a JPG:

| Foto | Original |
|---|---|
| `habitacion-vacia.jpg` | https://www.rawpixel.com/image/9657978/modern-home-interior |
| `sala-vacia-cocina-abierta.jpg` | https://www.rawpixel.com/image/6043458/photo-image-public-domain-wood-kitchen |
| `dormitorio-ventanal.jpg` | https://www.rawpixel.com/image/5920688/photo-image-public-domain-house-home |
| `dormitorio-moderno.jpg` | https://www.rawpixel.com/image/5917601/image-public-domain-wood-house |
| `bano-blanco.jpg` | https://www.rawpixel.com/image/5921891/photo-image-light-public-domain-shadow |
| `cocina-blanca-isla.jpg` | https://www.rawpixel.com/image/6039071/photo-image-public-domain-minimal-wood |
| `estudio-ventanal.jpg` | https://www.rawpixel.com/image/5916279/photo-image-background-design-public-domain |
