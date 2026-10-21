# ADR-0024 — Texturas PBR sembradas, acabados dibujados y luz más real (fase 1 del plan v7)

**Estado:** aceptada · **Fecha:** 2026-10-21

## Contexto
El visor se veía de maqueta. Tenía estos problemas:

- Solo el piso llevaba textura: un canvas de 512 px que además hacía de relieve.
- Paredes y muebles eran de un color liso.
- Las lámparas no daban sombra y el sol tenía una cámara de sombras mucho más grande que el cuarto.
- Un acabado descrito por la persona ("baldosa brillante azul claro con verde", ADR-0023) no
  tenía forma de verse.

## Decisión
- **Texturas PBR CC0 de Poly Haven, sembradas igual que los modelos.**
  - `cli/catalog/textures.ts` baja 21 juegos en 1k, con tres mapas: color, normal y `arm`
    (oclusión, rugosidad y metal). Los pasa a WebP de 1024 px y los sube al almacenamiento.
  - Las claves llevan el hash del contenido. Además publica `textures/manifest.json` con el tamaño
    real de cada textura (en metros) y su color medio.
  - `GET /api/textures` sirve el manifiesto con URLs, y cada imagen se sirve con caché inmutable.
  - Sin red (`CATALOG_OFFLINE`, CI), el manifiesto queda vacío y la web dibuja las suyas en canvas.
  - Las imágenes **no se commitean**.
- **Una textura sirve a varios colores.**
  - Cada material de la biblioteca apunta a un juego (`TEXTURE_SOURCES`). Su color se consigue
    multiplicando el mapa por `tint = color / colorMedio`, en espacio lineal. Así un solo roble
    sirve para roble, fresno y teca.
  - La pintura no toma el color de su textura: toma solo el relieve fino del enlucido.
- **Los acabados propios (`FinishSpec`) se dibujan.**
  - `pattern-textures.ts` pinta, sin costuras, estos dibujos: liso, cuadrícula, damero, metro,
    espiga, hexágono, mosaico y tablones. Usa los colores y la junta pedidos, con una variación
    de tono por pieza que siempre sale igual (determinista).
  - El relieve sale de la propia máscara, con un filtro Sobel.
  - Es local, sin IA y sin descargas, así que un acabado nuevo se ve al instante.
- **Coordenadas de textura en metros.**
  - Paredes, piso y muebles paramétricos se mapean "de caja" (`metricBoxUVs` y `boxUVs`). Así una
    textura de 2 m mide 2 m en cualquier pieza.
  - Las UV de los muebles se calculan en el adaptador de three (`parametric-renderer.ts`) y no en
    `furniture-kit`. Ahí ya están las normales finales y el kit sigue sin saber nada de texturas.
- **Una sola biblioteca de texturas por escena.** La crea `RoomView` y la comparten los muebles.
  Cuando llega el manifiesto, se vuelven a vestir el cuarto y los muebles que ya existen.
- **Luz:**
  - La cámara de sombras del sol se ajusta a la diagonal del cuarto. Con el mismo mapa la sombra
    sale unas tres veces más fina.
  - `finishes.lighting` cambia el tono (cálida, neutra, fría) y la fuerza (tenue, media, alta) de
    las lámparas y de la luz del techo.
  - En calidad alta, las dos primeras lámparas proyectan sombra. La lámpara no se hace sombra a sí
    misma.
  - La luz de una lámpara se aparta 40 cm de la pared más cercana. Con la pantalla abierta hacia
    los lados, pegada a la pared, la quemaba de blanco.
  - Las lámparas GLB encienden los materiales cuyo nombre dice pantalla, bombilla o vidrio.
- **Posprocesado:**
  - El bloom depende de la hora: no hay de día, es suave por la tarde y algo más fuerte de noche.
  - Tiene un umbral alto y la entrada acotada, para que un punto muy intenso no lave media imagen.
  - Con oclusión ambiental activa se esconden las penumbras pintadas junto a las paredes.
- **El vidrio deja pasar la luz.** Usa `transmission` en lugar de opacidad: se ve lo de atrás y
  refleja el cuarto.
- **Al caminar, la cabeza sube y baja 1.6 cm con cada paso de 70 cm.** Al parar, termina el medio
  paso y vuelve exacta a la altura de los ojos, sin tirones.

## Consecuencias
- El seed tarda más la primera vez: son unos 60 MB de descarga. Después queda en caché en disco.
- Las texturas cuestan memoria de GPU, unos 4 MB por mapa. Más adelante (fase 6), el límite por
  calidad y la recuperación tras perder el contexto WebGL tendrán que contarlas.
- El vidrio con transmisión añade un pase de dibujo cuando hay vidrio a la vista.
- Desviaciones respecto del plan:
  - No se descargó HDRI: el `RoomEnvironment` ya da reflejos aceptables y se ahorra la descarga.
  - Se usa `PCFShadowMap` con radio, en lugar de `PCFSoftShadowMap`, que está obsoleto en three r183.
  - No hay SMAA: el destino del compositor ya usa MSAA x4.
