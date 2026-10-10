# ADR-0011 — Análisis de la foto con un modelo de visión

**Estado:** aceptada · **Fecha:** 2026-10-10

## Contexto
El análisis local (OpenCV) casi no usaba la foto: partía de medidas fijas por tipo de cuarto,
ponía la puerta siempre en la misma pared y descartaba los objetos detectados. Ninguna app de
referencia convierte bien una sola foto en un cuarto 3D; las que se acercan combinan lo que la IA
entiende con la confirmación del usuario. Antes de construir se midió con seis fotos reales qué
entiende un modelo multimodal (`docs/pruebas-vision/`): acierta el tipo de cuarto, la pared de
cada abertura, el inventario y los colores; las medidas son aproximadas y la forma no la resuelve.

## Decisión
- **El modelo entrega semántica, no coordenadas.** Responde un JSON (`RoomGuess`): tipo, forma,
  medidas aproximadas, aberturas por pared como fracción, inventario de muebles y paleta. Un
  constructor determinista (`shell_from_guess`) decide dónde cae cada abertura, con qué tamaño, y
  descarta lo que no es físico. Es el mismo reparto que ya usa el chat (ADR-0009).
- **Otro proveedor del mismo puerto (Strategy).** `VisionRoomAnalyzer` implementa `RoomAnalyzer`;
  se elige con `ROOM_ANALYZER=vision`. Su trabajo es un Template Method: preparar la imagen →
  preguntar → validar → construir. Habla con el modelo por el puerto `VisionClient`; hoy hay un
  adaptador, `GroqVisionClient` (API compatible con OpenAI). Cambiar de modelo o de proveedor es
  otro adaptador.
- **Respaldo (Decorator).** `FallbackRoomAnalyzer` envuelve a la visión con el análisis local: si
  el modelo alcanza su límite, está caído o devuelve algo inválido, el proyecto se crea igual y
  la respuesta dice quién contestó. Sin `GROQ_API_KEY` el servicio arranca con el análisis local.
- **Uso medido de una capa gratuita.** Una llamada por foto, imagen reducida a 1024 px, caché por
  hash de la imagen, tope diario (`VISION_PER_DAY`), sin reintentos ante un 429 y sin propagar el
  cuerpo de los errores del proveedor. La clave vive solo en variables de entorno.
- **La foto decide qué se coloca.** El inventario viaja a la distribución (`inventory`): se ponen
  los roles imprescindibles más los que estaban en la foto, incluidos los que no son típicos del
  tipo de cuarto (el comedor de una sala abierta), y tantos como se vieron (una o dos mesitas).
- **La foto decide los colores.** `finishesFromPhoto` elige la pintura y el piso de la biblioteca
  más cercanos a los detectados, comparando en CIE Lab para que el tono pese como lo ve el ojo.
- **El usuario confirma.** El cuarto queda con confianza media y `needsCalibration`: el editor
  sigue ofreciendo escribir las medidas reales o calibrar con una. Si el usuario definió el
  cuarto a mano en el asistente, eso manda y de la foto solo salen inventario, colores y estilos.

## Consecuencias
- Seis fotos distintas dan seis cuartos distintos (medidas, aberturas, colores y muebles).
- El resultado depende de un servicio externo no determinista: dos análisis de la misma foto
  pueden diferir. Las pruebas usan un cliente falso y CI nunca llama a la API real; las E2E
  corren con `ROOM_ANALYZER=mock`.
- La caché y el tope diario viven en memoria por proceso: con dos workers de uvicorn el tope
  efectivo es el doble y una foto repetida puede costar dos llamadas.
- El inventario no se guarda: "Reacomodar" vuelve a la plantilla del tipo de cuarto.
- Lo que el modelo nombra y no tiene rol se ignora. (Al escribir esta decisión faltaban el tipo
  de cuarto "cocina" y los roles de isla, taburetes y gabinetes; se añadieron después, junto con
  el baño.)
- El contrato con la IA creció con campos opcionales (`category`, `count`, `nearWall`,
  `suggestions`, `inventory`): el análisis local no los envía y todo sigue funcionando sin ellos.
