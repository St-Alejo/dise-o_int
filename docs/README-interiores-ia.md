# Diseño de Interiores con IA + Vista 3D

> Documento de arquitectura y contexto de producto, escrito para que un agente de ingeniería (Claude Code) pueda planificar e implementar el proyecto directamente a partir de este archivo. No es material de presentación: es la base técnica de trabajo.

---

## 0. TL;DR para quien vaya a implementar esto

- El usuario sube **una foto de su cuarto**. El sistema la analiza (profundidad, paredes, muebles existentes) y genera **dos salidas complementarias**, no una sola:
  - **Track A — Preview 2D instantáneo**: una imagen fotorealista del cuarto rediseñado (ControlNet + difusión), en ~10-20s. Es el "wow" rápido que ya ofrecen los competidores (RoomGPT, GenRoom, Interior AI).
  - **Track B — Escena 3D editable**: una reconstrucción 3D navegable del cuarto con muebles reales del catálogo (con dimensiones y precio reales), que el usuario puede mover, cambiar y ver en AR. **Esto es el diferenciador real** — casi ningún competidor ofrece una escena 3D editable con catálogo comprable, la mayoría solo genera imágenes.
- Stack recomendado: **Angular (standalone + signals) para toda la app**, con **Three.js integrado a mano** (no un wrapper) dentro de un único componente de viewport, correctamente aislado de Change Detection. Backend en **NestJS + Python (FastAPI) para IA**, cola de trabajos con **BullMQ + Redis**, Postgres + S3, mismo patrón que ya usamos en el proyecto de mapeo de planos.
- La parte más honesta y crítica del proyecto: **estimar profundidad desde una sola foto da escala relativa, no real** — el sistema necesita un paso de calibración o corrección manual. Está resuelto en la sección 8.

---

## 1. Contexto: qué existe hoy y dónde encaja este proyecto

El mercado de "IA para diseño de interiores" ya es real y grande (~USD 3.28B en 2025, según estimaciones de la industria) y está lleno de herramientas, pero casi todas resuelven el mismo problema de la misma forma limitada:

| Producto | Qué hace bien | Qué le falta |
|---|---|---|
| **RoomGPT / ReRoom AI** | Fueron los primeros; transforman el estilo de una foto con difusión | Solo cambian estilo de la imagen 2D; catálogo de estilos fijo; nada navegable ni editable |
| **GenRoom / HomeDesigns AI** | Cobertura amplia (interior, fachada, jardín), 80+ estilos, barato/gratis | Sigue siendo generación de imagen, no un modelo 3D real que se pueda recorrer |
| **Interior AI** | Simplicidad: subir, elegir estilo, generar | Mismo límite: imagen fija, sin edición de objetos individuales |
| **MeltFlex** | Único con muebles a **escala real** integrados en el diseño mismo, tanto en foto como en 3D; catálogo comprable | Presentado como caso más avanzado — confirma que "3D real + catálogo comprable" es donde está el filo de la navaja del mercado |
| **HomeDesigns AI / REimagine Home / Collov AI** | Añadieron "Furniture Finder": conectan el render generado con productos reales comprables | El vínculo con el producto real llega *después* de generar la imagen (búsqueda inversa), no está integrado en el flujo 3D |
| **Rayon** | Planificación de espacios asistida por IA, bueno para arquitectos profesionales | No es para el consumidor final; no genera renders fotorealistas ni 3D navegable para el usuario común |

**Conclusión de la investigación**: el mercado ya resolvió bien la parte de "generar una imagen bonita de mi cuarto con otro estilo" (track A). Lo que casi nadie resuelve bien es la parte de "tener un modelo 3D real de mi cuarto donde pueda mover un sofá específico, ver cuánto cuesta, y verlo en mi casa por AR" (track B). Ese es el espacio donde este proyecto debe apuntar para no ser "uno más".

### 1.1 Por qué se recomienda no competir solo en Track A

Track A (imagen generada) se ha vuelto una commodity: hay al menos 14 herramientas serias haciendo exactamente eso, con motores de difusión cada vez más intercambiables (Stable Diffusion, SDXL, Realistic Vision, modelos propietarios). Cualquier producto nuevo que *solo* haga esto entra a competir en un mercado saturado por precio y volumen de estilos, no por tecnología.

Track B es estructuralmente más difícil (visión 3D, estimación de profundidad, colocación de objetos con física básica, catálogo con modelos 3D reales) — y por eso mismo es donde hay menos competencia real y donde el proyecto tiene más para enseñar en un portafolio o defender en una arquitectura técnica.

---

## 2. Propuesta de valor y experiencia objetivo

Una persona sube una foto de su sala. En menos de un minuto:

1. Ve **3-4 variantes de estilo** fotorrealistas de su propio cuarto (track A), comparables lado a lado con un slider "antes/después".
2. Elige una que le gusta y presiona **"Ver en 3D"**.
3. Aparece su cuarto reconstruido en 3D, con muebles reales del catálogo ya colocados según el estilo elegido, y puede:
   - Rotar la cámara y caminar por el espacio.
   - Arrastrar cualquier mueble para moverlo.
   - Tocar un mueble y ver su nombre, precio y un botón "cambiar" que abre el catálogo filtrado por ese tipo de mueble.
   - Presionar **"Ver en mi cuarto" (AR)** sobre cualquier mueble individual, para verlo a escala real con la cámara del celular, sin salir del navegador.
4. Guarda el proyecto, lo comparte con un link, o exporta la lista de compras (con links reales a los productos).

Esto no es un flujo lineal impuesto: cada paso es opcional y el usuario puede quedarse solo en el track A si eso es lo que quería (alguien que solo quiere "ver cómo se vería pintado de otro color" no necesita nunca tocar el 3D).

---

## 3. Flujo de usuario completo (con justificación de UX)

Cada paso está diseñado con un hallazgo específico de investigación de UX de apps de IA en 2026, no por intuición:

### Paso 1 — Antes de subir la foto
Se muestran 2-3 tips visuales **antes** de que el usuario suba nada (no después de un mal resultado): foto de frente, bien iluminada, mostrando el cuarto completo. Esto viene directo de la investigación: *"Lighting matters more than camera quality"* y *"most tools work best with well-lit, straight-on photos"* son los hallazgos más repetidos entre las herramientas evaluadas. Prevenir el mal input es más barato que corregir un mal resultado.

### Paso 2 — Procesamiento (el momento más delicado de la UX)
Nunca un spinner genérico. Se usa un patrón de **estados de carga descriptivos y secuenciales** (investigación 2026 en UX de apps de IA: reduce el tiempo de espera *percibido* entre 55-70% aunque el tiempo real sea idéntico):

```
"Analizando la geometría de tu espacio..."
"Detectando muebles y superficies..."
"Generando 3 propuestas de diseño..."
"Preparando el modelo 3D..."
```

Cada etapa tiene su propio ícono/animación y una barra de progreso real (no falsa), alimentada por el estado real del job en la cola (mismo patrón WebSocket que en el proyecto de mapeo de planos).

### Paso 3 — Resultados del Track A (2D)
Comparador **antes/después con slider arrastrable** (patrón estándar validado por ArchyBase, GenRoom y otros — es la forma en que la gente entiende "qué cambió" de un vistazo). Se muestran 3-4 estilos a la vez, no uno solo: la investigación de mercado es explícita en que "tu primera generación casi nunca es la mejor" — forzar una sola opción castiga al usuario con una mala primera impresión.

Se incluye un control deslizante de **"intensidad del cambio"** (cuánto se aleja del original) — es la función que un revisor experto (Decorilla) identificó como diferenciador real entre herramientas, porque le da al usuario control sobre qué tan conservador o radical es el rediseño.

### Paso 4 — Transición a 3D
Un solo botón: **"Ver en 3D"**. No se fuerza a nadie a entrar al 3D — es progressive disclosure real: la complejidad (mover muebles, catálogo, AR) solo se revela cuando el usuario decide que la quiere.

### Paso 5 — Edición en 3D
- Arrastrar y soltar directo sobre la escena (raycasting), no menús.
- Panel lateral contextual que solo aparece al seleccionar un mueble (nunca todo el catálogo de una vez — progressive disclosure otra vez).
- Deshacer/rehacer siempre visible (patrón Command, ver sección 9) — el usuario debe sentir que puede experimentar sin miedo a romper el diseño.

### Paso 6 — AR ("ver en mi cuarto")
Botón por mueble individual y botón para la escena completa. Usa el patrón estándar de la industria: `<model-viewer>` o WebXR nativo con `hit-test`, cayendo a Quick Look en iOS y Scene Viewer en Android cuando WebXR no está disponible — así funciona en el mayor número de teléfonos posible sin app nativa.

### Paso 7 — Guardar y compartir
Proyecto guardado con versiones (no se sobreescribe el diseño anterior al generar uno nuevo — Krea separa explícitamente "generar" de "editar" por esta razón). Link público de solo lectura para compartir con pareja/familia/cliente. Exportar lista de compras como PDF o link.

---

## 4. Arquitectura de alto nivel

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENTE — Angular (standalone components + signals)                │
│  ┌───────────────┐  ┌──────────────────┐  ┌───────────────────────┐ │
│  │ Upload / Wizard│  │ Galería 2D (A)   │  │ Viewport 3D (B)       │ │
│  │                │  │ compare-slider   │  │ Three.js + drag&drop  │ │
│  └───────────────┘  └──────────────────┘  └───────────────────────┘ │
│           DesignProjectStore (signals) — única fuente de verdad     │
└───────────────────────────────┬───────────────────────────────────┘
                                 │ REST + WebSocket (progreso en vivo)
┌───────────────────────────────▼───────────────────────────────────┐
│  API GATEWAY — Node.js / NestJS                                    │
│  Controllers · Casos de uso (AnalyzeRoom, GenerateStyle,            │
│  BuildScene, PlaceFurniture, Export) · Puertos (interfaces)         │
└───────────────────────────────┬───────────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  BullMQ + Redis          │  (jobs asíncronos:
                    │  cola de trabajos        │   generación es lenta)
                    └────────────┬────────────┘
                                 │
┌───────────────────────────────▼───────────────────────────────────┐
│  MICROSERVICIO DE IA — Python + FastAPI                            │
│  ┌─────────────────┐ ┌───────────────────┐ ┌────────────────────┐ │
│  │ Room Understanding│ │ Track A: Preview  │ │ Track B: Layout 3D │ │
│  │ depth + segment.  │ │ ControlNet + SD/  │ │ placement engine   │ │
│  │ + layout estimate │ │ SDXL img2img      │ │ (reglas o ATISS)   │ │
│  └─────────────────┘ └───────────────────┘ └────────────────────┘ │
└───────────────────────────────┬───────────────────────────────────┘
                                 │
┌────────────────────┐  ┌───────▼────────┐  ┌─────────────────────┐
│ PostgreSQL          │  │ S3 / R2        │  │ Catálogo de muebles  │
│ proyectos, catálogo,│  │ fotos, renders,│  │ GLB + dimensiones +  │
│ usuarios, versiones │  │ modelos GLB    │  │ precio + link real   │
└────────────────────┘  └────────────────┘  └─────────────────────┘
```

---

## 5. Decisión de stack: por qué Angular, y cómo evitar sus puntos débiles con 3D

Fuiste explícito en querer Angular, y es una elección **defendible** para este proyecto — pero hay que ser honesto sobre el trade-off antes de comprometerse, porque la investigación es clara en un punto:

| Criterio | Angular + Three.js (elegido) | React + React Three Fiber |
|---|---|---|
| Ecosistema 3D | Inmaduro: no hay un wrapper dominante; se integra Three.js a mano | Muy maduro: `@react-three/drei`, `@react-three/rapier` (física), `@react-three/postprocessing` — todo declarativo |
| Ajuste al resto de la app | **Excelente** para la parte "de producto" (formularios, catálogo, proyectos, auth, estado tipado con RxJS/signals) — es justo el tipo de app estructurada y grande para la que Angular brilla | También bueno, pero sin la inyección de dependencias y estructura opinada de Angular |
| Curva de trabajo del viewport 3D | Hay que escribir el render loop, el manejo de recursos y el drag-and-drop a mano | Se resuelve con hooks (`useFrame`, `useThree`) casi gratis |
| Riesgo principal | Que el render loop de Three.js dispare Change Detection de Angular en cada frame (60 veces por segundo) si no se aísla correctamente | Ninguno de este tipo — R3F ya vive fuera del ciclo de reconciliación de React por diseño |

**Decisión**: se mantiene Angular, precisamente porque la mayoría de esta app *no es* el viewport 3D — es catálogo, proyectos, autenticación, formularios, estado de la galería de estilos — y ahí Angular con signals es una base sólida y ordenada. El viewport 3D se trata como una **caja negra aislada**: un único componente (`ThreeViewportComponent`) que:

1. Corre su render loop **fuera** de la zona de Angular con `NgZone.runOutsideAngular()`, para que Three.js no dispare Change Detection 60 veces por segundo.
2. Expone su estado hacia el resto de la app **solo** a través de un `SceneService` inyectable, con Signals/Observables (ej. `selectedFurniture`, `sceneReady`), nunca al revés.
3. Libera manualmente toda la memoria GPU (`geometry.dispose()`, `material.dispose()`, `renderer.dispose()`) en `ngOnDestroy` — Three.js no tiene garbage collection automático de recursos GPU, y esto es la causa número uno de fugas de memoria en integraciones Angular+Three.js mal hechas.

```typescript
// three-viewport.component.ts — patrón de aislamiento correcto
@Component({ selector: 'app-three-viewport', standalone: true, template: `<canvas #canvas></canvas>` })
export class ThreeViewportComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  private renderer!: THREE.WebGLRenderer;
  private frameId?: number;

  constructor(private zone: NgZone, private scene: SceneService) {}

  ngAfterViewInit() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvasRef.nativeElement, antialias: true });
    // Todo el render loop vive FUERA de Angular — Angular nunca se entera de estos frames.
    this.zone.runOutsideAngular(() => this.animate());
  }

  private animate = () => {
    this.frameId = requestAnimationFrame(this.animate);
    this.scene.tick(); // avanza física/animaciones internas
    this.renderer.render(this.scene.scene, this.scene.camera);
  };

  ngOnDestroy() {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.scene.dispose(); // libera geometrías, materiales y texturas GPU
    this.renderer.dispose();
  }
}
```

Si en algún punto el equipo decide que el viewport 3D merece más inversión declarativa (animaciones complejas, física avanzada), la alternativa honesta es migrar *solo esa parte* a una micro-app en React+R3F embebida como Web Component — pero no se recomienda para el MVP: añade complejidad de integración que no se justifica todavía.

---

## 6. El pipeline de IA en detalle (los dos tracks)

### 6.0 Room Understanding — el paso que alimenta ambos tracks

Antes de generar cualquier cosa, toda foto pasa por un análisis común:

1. **Estimación de profundidad monocular** (ej. Depth-Anything-V2): produce un mapa de profundidad *relativa* de la escena.
2. **Segmentación semántica**: separa paredes, piso, techo, ventanas y muebles existentes (modelos de segmentación tipo SAM o un modelo entrenado específico para interiores).
3. **Estimación de layout de la habitación**: asumiendo "mundo Manhattan" (paredes en ángulos rectos, como hacen LayoutNet/HorizonNet), se estima la caja 3D aproximada del cuarto — esquinas, altura de techo, posición de puertas/ventanas.

El resultado es un **RoomShell**: la geometría 3D aproximada y vacía del cuarto, más las máscaras de cada mueble existente. Este RoomShell es la entrada compartida de los dos tracks.

### 6.1 Track A — Preview 2D instantáneo (rápido, fotorrealista, no editable)

Pipeline validado por múltiples implementaciones reales de código abierto y modelos comerciales:

```
Foto original
   │
   ▼
Máscara de elementos NO estructurales (todo excepto paredes/piso/techo/ventanas)
   │
   ▼
ControlNet (segmentación o Canny/MLSD) + Stable Diffusion / SDXL en modo inpainting
   │   prompt: "[tipo de cuarto], [estilo elegido], [iluminación], fotorrealista, 4K"
   │   prompt_strength bajo (0.5–0.7) para preservar más la estructura real
   ▼
Imagen rediseñada, con paredes/ventanas/geometría intactas
```

La clave técnica (confirmada por varias implementaciones reales evaluadas) es usar **dos ControlNets en paralelo**: uno de segmentación (para bloquear paredes/ventanas/puertas en su lugar) y uno de bordes tipo MLSD (para preservar líneas arquitectónicas rectas). Solo lo que no es estructural —muebles, decoración, colores— se deja libre para que la difusión lo rediseñe.

Este track se puede implementar rápido apoyándose en APIs de inferencia ya existentes (Replicate, servicios equivalentes) para no tener que operar GPUs propias desde el día uno — es la ruta correcta para el MVP.

### 6.2 Track B — Escena 3D editable con muebles reales (el diferenciador)

Este es el track que ningún competidor evaluado resuelve bien, y es donde vale la pena invertir el esfuerzo de ingeniería real:

```
RoomShell (de 6.0) + estilo elegido (de Track A, opcional)
   │
   ▼
Selección de piezas del catálogo que encajan con el estilo
   │   (filtrado por tags de estilo + tipo de habitación)
   ▼
Motor de colocación de muebles (layout engine)
   │   Opción simple (MVP):  reglas + minimización de costo
   │     (ej. "greedy cost minimization" — sofá contra la pared más larga,
   │      mesa centrada, evitar solapamientos, respetar zonas de paso)
   │   Opción avanzada (v2): modelo tipo ATISS (transformer autoregresivo
   │      entrenado en datasets como 3D-FRONT) que aprende distribuciones
   │      realistas de muebles dado el tipo y forma del cuarto
   ▼
Escena 3D: RoomShell + FurniturePlacement[] con modelos GLB reales a escala
   │
   ▼
Three.js renderiza la escena → usuario arrastra, cambia, ve en AR
```

Para el catálogo de muebles del MVP, la ruta más rápida y sin fricción legal es partir de **bibliotecas de modelos 3D de licencia abierta** (ej. colecciones CC0/CC-BY de muebles ya catalogadas y curadas), en vez de intentar generar o conseguir modelos de marcas reales desde el día uno — eso se aborda en la sección 8 como una decisión de producto, no solo técnica.

---

## 7. Modelo de datos canónico

Igual que en el proyecto de mapeo de planos, todo el sistema comparte un único esquema — el pipeline de IA, el editor 3D y el catálogo nunca deben tener representaciones distintas del mismo dato.

```typescript
interface Vector3 { x: number; y: number; z: number; }

interface RoomShell {
  id: string;
  widthM: number;
  depthM: number;
  heightM: number;
  walls: WallSegment[];
  openings: Opening[];       // puertas y ventanas detectadas
  scaleConfidence: number;   // 0–1: qué tan confiable es la escala estimada
  needsCalibration: boolean; // true si el usuario aún no confirmó una medida real
}

interface WallSegment {
  id: string;
  start: Vector3;
  end: Vector3;
  hasWindow: boolean;
}

interface Opening {
  id: string;
  type: 'door' | 'window';
  wallId: string;
  widthM: number;
  heightM: number;
}

interface CatalogItem {
  id: string;
  name: string;
  category: 'sofa' | 'table' | 'chair' | 'bed' | 'storage' | 'lighting' | 'decor';
  styleTags: string[];       // ['escandinavo', 'minimalista', ...]
  dimensionsM: Vector3;      // ancho, alto, profundidad reales
  modelUrl: string;          // GLB
  price?: number;
  productUrl?: string;       // link real de compra, si existe
  license: 'cc0' | 'cc-by' | 'proprietary' | 'affiliate';
}

interface FurniturePlacement {
  id: string;
  catalogItemId: string;
  position: Vector3;
  rotationY: number;         // rotación en el eje vertical, suficiente para muebles
  lockedByUser: boolean;     // true si el usuario ya lo movió a mano (no lo re-optimiza el layout engine)
}

interface StylePreview {
  id: string;
  styleName: string;
  imageUrl: string;          // resultado del Track A
  promptStrength: number;
}

interface DesignProject {
  id: string;
  ownerId: string;
  sourcePhotoUrl: string;
  roomShell: RoomShell;
  stylePreviews: StylePreview[];
  selectedStyleId?: string;
  furniturePlacements: FurniturePlacement[];
  versions: DesignProjectVersion[]; // historial, nunca se sobreescribe en sitio
  visibility: 'private' | 'shared-link';
}
```

---

## 8. Riesgos técnicos y cómo se mitigan (análisis honesto)

Esta sección existe porque un producto real se juzga por cómo maneja sus propias limitaciones, no por pretender que no existen.

1. **La profundidad monocular es relativa, no real.** Un modelo de depth estimation dice "esto está más lejos que aquello", no "esto está a 3.2 metros". Sin esto resuelto, el 3D generado puede tener proporciones incorrectas.
   - *Mitigación*: paso de calibración de un solo gesto — el usuario confirma o ajusta una medida conocida (ej. "la puerta mide ~2m", valor por defecto editable) y el sistema reescala todo el RoomShell con ese factor. Se marca `scaleConfidence` y `needsCalibration` en el modelo de datos para que la UI lo muestre con transparencia ("medida aproximada, ajústala si quieres precisión").

2. **La colocación automática de muebles puede verse "robótica" o poco realista.** Las reglas simples (greedy cost minimization) funcionan para el MVP pero generan resultados genéricos.
   - *Mitigación*: se deja como mejora de v2 migrar a un modelo entrenado tipo ATISS sobre datasets de escenas reales (3D-FRONT), que aprende distribuciones espaciales realistas en vez de reglas fijas. No es necesario para validar el producto.

3. **Legalidad de modelos 3D de muebles de marcas reales.** Usar el modelo 3D exacto de un sofá de una marca sin acuerdo puede ser un problema de propiedad intelectual.
   - *Mitigación de producto*: MVP con catálogo propio curado de licencia abierta (CC0/CC-BY). El vínculo con "comprar el producto real" se resuelve, como ya hacen varios competidores evaluados, con una capa de **búsqueda de producto similar** (afiliados/API de retailers) que conecta el mueble genérico mostrado con una opción real comprable — sin necesitar el modelo 3D exacto de la marca.

4. **Privacidad de las fotos.** Una foto de la sala de alguien es información sensible sobre su hogar.
   - *Mitigación*: procesamiento transitorio por defecto (la foto no se retiene más allá del job de análisis salvo que el usuario guarde el proyecto explícitamente); nunca se usa para reentrenar modelos sin consentimiento explícito; borrado de proyecto = borrado real en S3, no solo soft-delete en la base de datos.

5. **Costo de inferencia de IA por generación.** Cada preview de estilo cuesta cómputo de GPU real.
   - *Mitigación*: cola de trabajos con límites por usuario/plan (mismo patrón BullMQ que en el proyecto de planos), caché de resultados por combinación (foto + estilo) para que regenerar lo mismo no vuelva a costar, y un tier gratuito limitado a N generaciones — patrón de negocio ya validado por todos los competidores evaluados ("primera generación gratis").

---

## 9. Patrones de diseño aplicados

| Patrón | Dónde | Por qué |
|---|---|---|
| **Strategy** | Motores de generación de estilo (podría haber más de un proveedor de difusión) y motores de layout (reglas vs. ATISS) | Cambiar de proveedor de IA o de algoritmo de colocación sin tocar el resto del sistema |
| **Facade** | `SceneService` como única puerta de entrada al mundo Three.js desde Angular | El resto de la app nunca toca `THREE.*` directamente |
| **Command** | Deshacer/rehacer al mover o cambiar muebles | Cada edición es un objeto reversible; necesario para que el usuario "experimente sin miedo" (ver sección 3) |
| **Repository** | Acceso a `DesignProject` y `CatalogItem` en Postgres | El dominio no sabe dónde viven los datos |
| **Adapter** | Integraciones con proveedores externos (API de difusión, API de afiliados de muebles) | Aísla el sistema de cambios en APIs de terceros |
| **Factory** | Instanciar geometría/material Three.js a partir de un `CatalogItem` | Centraliza cómo se construye cada tipo de objeto 3D |

---

## 10. Estructura de proyecto sugerida

```
interiores-ia/
├── apps/
│   ├── web/                          # Angular
│   │   └── src/app/
│   │       ├── core/                 # servicios singleton, guards, interceptors
│   │       ├── features/
│   │       │   ├── upload/           # wizard de subida + tips de foto
│   │       │   ├── style-gallery/    # resultados Track A + comparador
│   │       │   ├── viewport-3d/      # ThreeViewportComponent + SceneService
│   │       │   ├── catalog/          # drawer de catálogo, filtros por estilo
│   │       │   ├── ar-view/          # integración model-viewer / WebXR
│   │       │   └── projects/         # dashboard, guardar, compartir
│   │       └── shared/models/        # interfaces de la sección 7 (fuente única)
│   └── api/                          # NestJS
│       └── src/
│           ├── modules/
│           │   ├── rooms/            # AnalyzeRoomUseCase
│           │   ├── styles/           # GenerateStyleUseCase (Track A)
│           │   ├── scenes/           # BuildSceneUseCase, PlaceFurnitureUseCase (Track B)
│           │   ├── catalog/
│           │   └── projects/
│           └── ports/                # interfaces (IStyleGenerator, ILayoutEngine, ...)
├── services/
│   └── ai-worker/                    # Python + FastAPI
│       └── src/
│           ├── room_understanding/   # depth + segmentation + layout
│           ├── style_generation/     # ControlNet + difusión (Track A)
│           └── layout_engine/        # colocación de muebles (Track B)
└── packages/
    └── shared-types/                 # interfaces TS compartidas entre web y api
```

---

## 11. Stack tecnológico completo

| Capa | Herramienta | Notas |
|---|---|---|
| Frontend | Angular 18+ (standalone, signals) | App shell, catálogo, proyectos, formularios |
| Viewport 3D | Three.js (integración manual, ver sección 5) | Aislado con `NgZone.runOutsideAngular` |
| AR | `<model-viewer>` o WebXR nativo con hit-test | Fallback a Quick Look (iOS) / Scene Viewer (Android) |
| Estado | Angular Signals + `DesignProjectStore` | NgRx queda como opción si el estado crece mucho más adelante |
| Backend | Node.js + NestJS | Arquitectura hexagonal, igual que el proyecto de planos |
| Cola de trabajos | BullMQ + Redis | Toda generación de IA es asíncrona |
| IA — Room Understanding | Depth-Anything-V2 (profundidad) + modelo de segmentación tipo SAM + estimador de layout tipo HorizonNet | Microservicio Python/FastAPI |
| IA — Track A | ControlNet (segmentación + MLSD) + Stable Diffusion/SDXL inpainting | Se puede empezar con una API de inferencia hospedada para el MVP |
| IA — Track B | Motor de reglas (MVP) → modelo tipo ATISS (v2) | Python |
| Modelos 3D | glTF/GLB, comprimidos con Draco/Meshopt | Estándar web, ligero |
| Base de datos | PostgreSQL | Proyectos, catálogo, usuarios |
| Almacenamiento | S3 / Cloudflare R2 | Fotos, renders, modelos GLB |
| Infraestructura | Docker Compose (dev) | Igual patrón que el resto de proyectos del portafolio |

---

## 12. Roadmap por fases

- **Fase 0 — Validar el pipeline sin generación de IA todavía**: subir foto → RoomShell aproximado (aunque sea una caja genérica) → colocar muebles de un catálogo estático fijo a mano en Three.js → confirmar que Angular + Three.js integrado correctamente no tiene fugas de memoria ni problemas de Change Detection.
- **Fase 1 — Track A**: integrar ControlNet + difusión (vía API hospedada) para el preview 2D con comparador antes/después.
- **Fase 2 — Track B real**: Room Understanding completo (depth + segmentación + layout) y motor de colocación por reglas, con catálogo de licencia abierta.
- **Fase 3 — AR**: `<model-viewer>` / WebXR para ver muebles y la escena completa en el espacio real del usuario.
- **Fase 4 — Catálogo comprable**: integración con afiliados/API de retailers para conectar cada mueble genérico con un producto real comprable.
- **Fase 5 — Layout inteligente**: reemplazar las reglas del motor de colocación por un modelo entrenado tipo ATISS para distribuciones más realistas.

---

## 13. Métricas a medir

- Tiempo real vs. percibido de generación (para validar que el patrón de estados de carga está funcionando).
- Tasa de usuarios que pasan de Track A a Track B (valida si el 3D editable realmente engancha o es una función que nadie usa).
- Tasa de corrección manual de la calibración de escala (qué tan confiable es la estimación automática en la práctica).
- Tasa de clic en "ver en mi cuarto" (AR) y en links de compra del catálogo.
- Costo de inferencia de IA por usuario activo (control de negocio, no solo técnico).

---

## 14. Cómo debería proceder Claude Code con este documento

1. Empezar por la **Fase 0** (sección 12), sin tocar nada de IA todavía — el objetivo inicial es un Angular + Three.js correctamente aislado (sección 5) funcionando de punta a punta con datos falsos/estáticos.
2. Usar las interfaces de la sección 7 como los tipos compartidos desde el primer commit (`packages/shared-types`), no improvisar tipos distintos en frontend y backend.
3. Dejar los puertos (`IStyleGenerator`, `ILayoutEngine`) definidos desde el inicio aunque su implementación real (IA) llegue en la Fase 1/2 — así el resto del sistema no espera a que la IA esté lista para avanzar.
4. No implementar Track B con un modelo tipo ATISS de entrada — empezar con las reglas simples de la sección 6.2 y dejar la mejora para después de validar que el producto se usa.
