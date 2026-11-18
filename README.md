# Interiores IA

Aplicación web para rediseñar un cuarto a partir de una foto o de unas pocas medidas. La app levanta el
cuarto en 3D, lo amuebla con piezas reales a escala, propone estilos y entrega la lista de compras, los
planos y el presupuesto. Se edita a la vez en un plano 2D y en una vista 3D, se recorre a pie y se puede
exportar a Blender.

Proyecto final de Programación Orientada a la Web (semestre 7).

## Enlaces

| Qué | URL |
|---|---|
| Aplicación en línea (demo en Azure) | https://ca-interiores-web.bravecoast-df66f28f.brazilsouth.azurecontainerapps.io |
| Plantillas para probar sin cuenta | https://ca-interiores-web.bravecoast-df66f28f.brazilsouth.azurecontainerapps.io/plantillas |
| Estado de la API (salud de cada dependencia) | https://ca-interiores-web.bravecoast-df66f28f.brazilsouth.azurecontainerapps.io/api/health/ready |
| Plano 3D (proyecto hermano que se conecta con esta app) | https://lively-island-09e124b1e.5.azurestaticapps.net |
| Repositorio (versión final, rama `conexion`) | https://github.com/St-Alejo/dise-o_int/tree/conexion |

La demo en Azure escala a cero cuando nadie la usa: la primera visita puede tardar entre 20 y 40
segundos en responder mientras arrancan los contenedores.

Una vez corriendo en local (ver [Correr el proyecto en local](#correr-el-proyecto-en-local)):

| Qué | URL local |
|---|---|
| Aplicación | http://localhost:8080 |
| Plantillas sin cuenta | http://localhost:8080/plantillas |
| Documentación de la API (Swagger) | http://localhost:8080/api/docs |
| Salud de la API | http://localhost:8080/api/health/ready |

## Contenido

- [Qué hace](#qué-hace)
- [Tecnologías](#tecnologías)
- [Arquitectura](#arquitectura)
- [Correr el proyecto en local](#correr-el-proyecto-en-local)
- [Guía rápida de uso](#guía-rápida-de-uso)
- [Configuración opcional](#configuración-opcional)
- [Pruebas](#pruebas)
- [Programación orientada a objetos: patrones de diseño](#programación-orientada-a-objetos-patrones-de-diseño)
- [Seguridad y robustez](#seguridad-y-robustez)
- [Documentación adicional](#documentación-adicional)
- [Licencias de contenido](#licencias-de-contenido)

## Qué hace

### Crear el cuarto

- **Desde una foto o desde medidas.** Un asistente pide una foto (opcional) y las medidas, y muestra el
  plano con cotas mientras se escriben. Si no hay metro, se calibra con una sola medida conocida.
- **Seis tipos de cuarto:** sala, dormitorio, comedor, oficina, cocina y baño.
- **Forma real:** rectangular, en L, en T o en U, con puertas y ventanas en su pared.
- **Lectura de la foto.** Un análisis local con OpenCV estima medidas y colores. Con una clave de
  Claude (opcional), un modelo de visión lee además puertas, ventanas, muebles y estilo.

### Editar en 2D y 3D

- **Plano y 3D lado a lado,** y se edita en cualquiera de los dos: mover y girar muebles, cambiar sus
  medidas con tiradores, mover paredes y esquinas, añadir puertas y ventanas, pintar con un clic y medir.
- **Selección múltiple** para alinear, repartir, duplicar o quitar en grupo.
- **Deshacer y rehacer** de todo con Ctrl+Z y Ctrl+Y.
- **Recorrido a pie:** la cámara baja a la altura de los ojos y se camina con el teclado sin atravesar
  paredes ni muebles. Luz de día, tarde y noche, con lámparas que alumbran de verdad.
- **Guardado resistente:** si la red falla, los cambios esperan y se envían al volver; si se cierra la
  pestaña, al regresar se ofrece recuperarlos.

### Diseñar

- **Catálogo de 147 muebles** con búsqueda que entiende acentos, plurales, sinónimos y errores de
  tipeo. Cada pieza cambia de medidas (se reconstruye, no se estira) y de material.
- **Seis estilos:** escandinavo, minimalista, industrial, moderno, clásico y bohemio.
- **Otra distribución:** reacomoda los muebles de otra forma válida sin tapar ventanas ni bloquear la
  puerta, respetando los que se fijaron.
- **Revisión del diseño:** avisa si un mueble bloquea una puerta, tapa una ventana o deja el cuarto
  demasiado lleno.
- **Acabados y texturas reales:** baldosa, madera, piedra, pintura y más, con dibujo, brillo y tamaño
  de pieza; 21 texturas PBR de Poly Haven.
- **Zonas interiores:** baño privado, vestidor o tocador dentro de un cuarto.
- **Chat de diseño:** entiende frases como "pon piso de baldosa azul claro" o "agrega un tocador". Un
  modelo propio (scikit-learn) resuelve lo común sin servicios externos; con una clave de Claude
  (opcional), lo que el modelo local no entiende lo responde Claude usando las mismas herramientas.

### Entregar

- **Lista de compras y presupuesto** con tope por cuarto y total por categoría.
- **PDF del proyecto** con ficha, plano acotado y lista de compras; modo presentación a pantalla completa.
- **Versiones** comparables lado a lado y **enlace público** para compartir.
- **Realidad aumentada** ("ver en mi cuarto") desde el celular.
- **Viviendas:** varios cuartos agrupados en una planta conjunta, a escala.
- **Exportar a Blender:** descarga un `.blend` listo para abrir, con colecciones, cámara y luces.
- **Render fotorrealista (opcional):** si hay un nodo con GPU NVIDIA, la escena se renderiza en
  Blender Cycles y aparece en una galería.

### Modo Pro (arquitectos y diseñadores)

Un interruptor en la cabecera activa la pestaña **Pro** del editor:

- **Planos técnicos:** planta arquitectónica, amoblamiento, cielo raso, acabados, alzados y corte, en
  láminas A4 a A1 a escala. Descarga en SVG, DXF (AutoCAD y LibreCAD) y PDF.
- **Normativa y ergonomía:** perfiles de buenas prácticas (Neufert) y Colombia orientativo, con cálculo
  de iluminación y mapa de calor.
- **Cantidades y presupuesto de obra:** cómputo métrico, materiales a comprar, AIU y cronograma, en CSV
  y PDF.
- **Instalaciones:** puntos eléctricos e hidrosanitarios propuestos según los muebles, con cuadro de
  cargas.

### Conexión con Plano 3D

Desde `/conectar` la app se enlaza con el proyecto hermano Plano 3D: una casa dibujada allí llega con
todos sus pisos y cuartos, se ve en 3D y cada cuarto se puede amueblar en su sitio.

## Tecnologías

| Capa | Tecnologías |
|---|---|
| Frontend | Angular 22 (componentes standalone, signals, sin zone.js), TypeScript 6, Three.js 0.183, `<model-viewer>` para realidad aumentada, GSAP y Lenis para la portada |
| Backend | NestJS 12 con arquitectura hexagonal, Prisma 7, BullMQ 6 (colas), Socket.IO (progreso en vivo), zod 4 (validación) |
| Servicio de IA | Python, FastAPI, Pydantic 2, OpenCV, scikit-learn, SDK de Anthropic (Claude, opcional) |
| Render (opcional) | Blender 4.2 con Cycles en un contenedor con GPU NVIDIA |
| Datos | PostgreSQL, Redis, almacenamiento compatible con S3 (SeaweedFS en local) |
| Infraestructura | Docker y Docker Compose, nginx (proxy y CSP), Azure Container Apps para la demo |
| Pruebas | Vitest, pytest con Hypothesis, Playwright con axe (accesibilidad) |
| Calidad | GitHub Actions: pruebas, lint, OSV-Scanner (vulnerabilidades) y Lighthouse CI |

## Arquitectura

```
                         +---------------- red "edge" ----------------+
  navegador --HTTPS-->   |  web: nginx (SPA Angular + proxy /api, CSP)  |
                         +---------------+------------------------------+
                                         | /api  y  /api/ws (WebSocket)
+------------------------ red "internal" (sin puertos publicados) ------------------------+
|  api (NestJS) --encola--> Redis/BullMQ --> worker (NestJS) --HTTP--> ai (FastAPI)       |
|     |   ^ progreso pub/sub <-------------------+                                         |
|     v   |                                                                               |
|  PostgreSQL (Prisma)          S3 (SeaweedFS en local)          blender (opcional, GPU)  |
|  migrate (una vez) y seed (una vez: descarga el catálogo de muebles)                    |
+-----------------------------------------------------------------------------------------+
```

| Carpeta | Contenido |
|---|---|
| `apps/web` | Frontend Angular. `SceneService` es la fachada de Three.js, `DesignProjectStore` la única fuente de verdad del diseño y la edición usa el patrón Command para deshacer y rehacer. |
| `apps/api` | API NestJS hexagonal: los casos de uso dependen de puertos (`src/ports`) y los adaptadores (Prisma, S3, BullMQ, Redis, HTTP a la IA) se enlazan en `CoreModule`. Incluye autenticación, PDF, progreso por WebSocket y el worker de trabajos. |
| `services/ai` | FastAPI: análisis de la foto, motor de distribución de muebles por reglas, modelos de lenguaje propios y chat con Claude. |
| `services/blender` | Nodo de render opcional: consume la cola `render-jobs`, renderiza con Blender y sube el resultado a S3. |
| `packages/shared-types` | Modelo del dominio con schemas zod, geometría compartida (colisiones, plantas poligonales) y el módulo Pro (planos, normativa, cantidades). Lo usan la web y la API. |
| `packages/furniture-kit` | Muebles paramétricos: recetas que generan la geometría de cada pieza según sus medidas. |
| `infra` | Configuración de nginx y scripts de despliegue en Azure. |
| `e2e` | Pruebas de punta a punta con Playwright, prueba de humo y prueba de resiliencia. |
| `docs` | Decisiones de arquitectura (ADR), diagrama de clases, guía de despliegue y capturas. |

## Correr el proyecto en local

### Requisitos

- **Docker Desktop** (Windows o macOS) o Docker Engine con Docker Compose v2 (Linux). Con 8 GB de RAM
  libres para Docker basta.
- **Git**.
- En Windows, **Git Bash** (viene con Git) para ejecutar los scripts `.sh`.
- Internet la primera vez: se descargan las imágenes base y unos 35 modelos 3D de Poly Haven.

No hace falta instalar Node, Python ni bases de datos: todo corre en contenedores.

### Pasos

```bash
# 1. Clonar el repositorio (la versión final está en la rama conexion)
git clone -b conexion https://github.com/St-Alejo/dise-o_int.git interiores
cd interiores

# 2. Crear el archivo .env con secretos aleatorios (una sola vez)
./scripts/init-env.sh

# 3. Construir las imágenes de la API, la web, la IA y las migraciones (10 a 15 minutos la primera vez)
./scripts/build-images.sh

# 4. Levantar todo y esperar a que cada servicio esté sano
docker compose up -d --wait
```

Después abrir **http://localhost:8080**.

- La primera vez, el servicio `seed` descarga y optimiza el catálogo de muebles; puede tardar unos
  minutos más. Sin internet se pueden usar muebles generados por código: poner
  `CATALOG_OFFLINE=true` en `.env` antes de levantar.
- Si el puerto 8080 está ocupado, cambiar `WEB_PORT` y `PUBLIC_WEB_URL` en `.env`.
- Para apagar todo: `docker compose down`. Para borrar también los datos: `docker compose down -v`.
- Con `make` disponible (Linux, macOS o WSL), `make up` hace los pasos 2 a 4 y `make help` lista el
  resto de comandos.

**Windows y rutas con tildes:** `docker compose build` falla si la ruta del proyecto tiene caracteres
no ASCII (por ejemplo "diseño"), con el error `x-docker-expose-session-sharedkey`. Por eso se usa
`scripts/build-images.sh`, que llama a `docker build` directamente. Aun así, conviene clonar en una ruta
sin tildes ni espacios, como `C:\proyectos\interiores`.

**La película de la portada:** los 480 fotogramas de la animación de la página de inicio
(`apps/web/public/cine/`) no están en el repositorio por su peso. Sin ellos, la portada muestra el
resto de secciones y el texto, pero no la animación del fondo. El resto de la aplicación no depende de
ellos. La animación completa se puede ver en la demo en línea.

### Comprobar que funciona

```bash
docker compose ps                                  # todos los servicios en estado healthy
curl http://localhost:8080/api/health/ready        # "status":"ok" con base de datos, Redis, S3 e IA
node e2e/smoke.mjs http://localhost:8080           # prueba de humo: 17 comprobaciones del flujo completo
```

### Modo desarrollo (recarga en caliente)

```bash
./scripts/build-images.sh api-dev web-dev ai-dev migrate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait
```

| Servicio | URL o puerto |
|---|---|
| Web (`ng serve`) | http://localhost:4300 |
| API (Swagger) | http://localhost:3300/api/docs |
| IA (FastAPI) | http://localhost:8800/docs |
| PostgreSQL / Redis / S3 | 15433 / 16380 / 18334 |

## Guía rápida de uso

1. **Probar sin cuenta.** En la portada, "Probar sin cuenta" o `/plantillas` abre cuartos ya
   amueblados en el editor completo. Los cambios quedan en el navegador.
2. **Crear una cuenta.** "Crear cuenta" (arriba a la derecha) con correo y contraseña. Al crearla, lo hecho en una plantilla
   se guarda en la cuenta.
3. **Nuevo proyecto.** "Diseñar mi cuarto" abre el asistente: tipo de cuarto, forma, medidas, puertas y
   ventanas y, si se quiere, una foto. Al terminar, la app arma el cuarto y propone una distribución.
4. **Editar.** Barra superior: vista 3D, plano o ambas. Clic en un mueble para seleccionarlo; arrastrar
   para moverlo; el aro lo gira y los tiradores cambian sus medidas. El catálogo está en el panel lateral.
5. **Recorrer.** El modo de recorrido de la barra del visor baja la cámara a la altura de los ojos; se camina con W, A, S y D
   o con las flechas.
6. **Pedir cambios al chat.** Por ejemplo: "estilo nórdico", "pon piso de madera clara", "agrega una
   lámpara de pie".
7. **Entregar.** "Exportar" ofrece la imagen, el plano con medidas, el PDF del proyecto, la lista de
   compras y el archivo de Blender. "Compartir" genera un enlace público.
8. **Modo Pro.** El interruptor "Modo Pro" de la cabecera activa planos técnicos, normativa,
   cantidades de obra e instalaciones.

## Configuración opcional

Por defecto todo funciona **sin claves ni GPU**: el análisis de la foto es local (OpenCV), el chat usa el
modelo propio y reglas, y los estilos se muestran con una vista previa simulada. Estas variables de
`.env` activan servicios externos:

| Variable | Efecto |
|---|---|
| `ANTHROPIC_API_KEY` | Activa Claude en el chat (`CHAT_LLM=claude`) y en la lectura de fotos (`ROOM_ANALYZER=vision`). `CLAUDE_BUDGET_USD` pone un tope de gasto. |
| `REPLICATE_API_TOKEN` | Con `ROOM_ANALYZER=replicate` y `STYLE_GENERATOR=replicate`, usa modelos de difusión para la profundidad y las propuestas de estilo. |
| `CATALOG_OFFLINE=true` | Muebles generados por código, sin descargar modelos. |
| `WEB_PORT` | Puerto de la web (8080 por defecto). |

Render fotorrealista con Blender (necesita GPU NVIDIA y Docker con soporte de GPU):

```bash
docker compose --profile gpu up -d blender
```

El estudio de render habilita el motor "Blender" cuando el nodo está encendido. Detalles en
[`docs/deploy.md`](docs/deploy.md).

## Pruebas

Las herramientas de Node corren dentro de Docker con `./scripts/toolbox.sh "<comando>"` (Node 24, igual
que las imágenes), así no hace falta instalar Node.

| Suite | Comando | Qué cubre |
|---|---|---|
| Tipos compartidos | `./scripts/toolbox.sh "npm test -w @interiores/shared-types"` | Geometría, colisiones, plantas poligonales, módulo Pro y DTOs |
| API | `./scripts/toolbox.sh "npm test -w api"` | Casos de uso con adaptadores en memoria: cuotas, concurrencia (409), borrado real, trabajos |
| Web | `./scripts/toolbox.sh "npm test -w web"` | Deshacer y rehacer, construcción del cuarto, plano, cámara, asistente, contraste de colores |
| IA | `make test-ai` | Distribución de muebles con Hypothesis (sin solapes, nunca bloquea puertas), lenguaje natural y contrato entre zod y Pydantic |
| Humo | `node e2e/smoke.mjs http://localhost:8080` | Flujo completo del backend a través de nginx |
| Interfaz y accesibilidad | `make e2e` | Playwright con axe (WCAG 2.1 AA) en escritorio y móvil |

Para las pruebas de punta a punta, levantar el stack con
`RATE_LIMIT_MULTIPLIER=20 ROOM_ANALYZER=mock docker compose up -d --wait`.

La integración continua (`.github/workflows/`) corre todas las suites en cada push, además del análisis
de vulnerabilidades con OSV-Scanner y Lighthouse CI sobre la portada.

## Programación orientada a objetos: patrones de diseño

| Patrón | Dónde está |
|---|---|
| Facade | `apps/web/.../viewport-3d/scene.service.ts`: oculta Three.js detrás de una interfaz pequeña |
| Command | `apps/web/.../viewport-3d/commands.ts` con `CommandHistory` y `MacroCommand`: deshacer y rehacer de cada edición |
| Strategy | Proveedores de IA (`services/ai/.../providers/*`), motor de distribución (`LayoutEngine`), montajes de muebles (`mount-strategies.ts`), presets de luz y desperdicio de materiales (`WasteStrategy`) |
| State | Modos de cámara (`OrbitMode`, `WalkMode`), herramientas del visor (`ToolManager`), gestos del plano y pasos del asistente |
| Decorator | `FallbackRoomAnalyzer`: si la visión falla, responde el análisis local |
| Template Method | `PlacementCommand` y `VisionRoomAnalyzer` (preparar, preguntar, validar, construir) |
| Repository | `apps/api/src/ports` con implementaciones en `infrastructure/prisma/*.repository.ts` y dobles en memoria para las pruebas |
| Adapter | `HttpAiClient`, `S3FileStorage`, `BullMqJobQueue`, `ReplicateClient` |
| Factory | `FurnitureFactory`, `RecipeRegistry`, plantillas de forma (`ROOM_TEMPLATES`) y símbolos de planos (`drawSymbol`) |
| Builder y Composite | `packages/furniture-kit/src/builder.ts` (piezas de muebles) y `DrawingBuilder` (láminas técnicas) |
| Composite y Visitor | Modelo de dibujo técnico en `pro/drawing/model.ts`, con un renderizador por formato: SVG, DXF y PDF |
| Specification | Reglas de normativa en `pro/compliance/rules.ts`; los perfiles cambian los valores sin tocar las reglas |
| Flyweight | Caché de modelos, geometrías, materiales y texturas en la GPU |
| Objeto de valor | `RoomPlan`: la planta conoce su área, dónde cabe un mueble y cuál es la pared del fondo |

El diagrama de clases está en [`docs/diagrama-de-clases.md`](docs/diagrama-de-clases.md).

## Seguridad y robustez

- **Autenticación:** JWT de acceso de 15 minutos guardado solo en memoria, refresh token rotativo en
  cookie httpOnly y contraseñas con argon2id.
- **Protección de la web:** CSP estricta, Helmet, límite de peticiones compartido en Redis y cuotas
  diarias por usuario.
- **Archivos:** validación por contenido real (un `.exe` renombrado a `.jpg` se rechaza), límite de
  tamaño y eliminación de EXIF y GPS de las fotos. Las URL de archivos van firmadas.
- **Privacidad:** los proyectos sin guardar se borran a las 24 horas y borrar un proyecto borra
  también sus archivos.
- **Concurrencia:** control optimista por revisión; si dos pestañas editan a la vez, la API responde
  409 y el editor se resincroniza.
- **Trabajos en segundo plano:** reintentos con espera creciente, auditoría y cierre ordenado del worker.
- **Observabilidad:** logs JSON con identificador de petición de extremo a extremo y comprobaciones de
  salud en todos los contenedores.
- **Contenedores:** builds multi-etapa con versiones fijadas, usuarios sin privilegios y redes
  separadas; solo la web publica un puerto.

## Documentación adicional

| Documento | Contenido |
|---|---|
| [`docs/README-interiores-ia.md`](docs/README-interiores-ia.md) | Documento de producto y arquitectura |
| [`docs/adr/`](docs/adr) | 39 registros de decisiones de arquitectura |
| [`docs/diagrama-de-clases.md`](docs/diagrama-de-clases.md) | Diagrama de clases |
| [`docs/deploy.md`](docs/deploy.md) | Despliegue en la nube (Azure, GHCR) y nodo de render con Blender |
| [`docs/pruebas-vision/`](docs/pruebas-vision) | Resultados de la lectura de fotos con seis cuartos reales |
| [`docs/capturas/`](docs/capturas) | Capturas de pantalla |

## Licencias de contenido

Los muebles 3D y las texturas PBR vienen de [Poly Haven](https://polyhaven.com) (CC0) o se generan por
código. Las fotos de ambiente de la página de inicio son CC0; fuente y autor en
[`apps/web/public/landing/fotos/ATTRIBUTION.md`](apps/web/public/landing/fotos/ATTRIBUTION.md). Los enlaces
de compra son búsquedas de productos similares.
