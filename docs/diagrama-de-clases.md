# Diagrama de clases y patrones

Las clases que sostienen el diseño, agrupadas por el patrón que aplican. No están todas: están las
que explican cómo está hecha la app. Los nombres son los del código.

## 1. Editor: estado, comandos y dónde se guarda

```mermaid
classDiagram
  class DesignProjectStore {
    +placements
    +shell
    +finishes
    +execute(command)
    +undo()
    +redo()
    +flush()
  }
  class SceneCommand {
    <<interface>>
    +label
    +apply(state)
    +revert(state)
  }
  class CommandHistory
  class MacroCommand
  class MoveCommand
  class SetRoomCommand
  class SetFinishesCommand
  class ProjectPersistence {
    <<abstract>>
    +get(id)
    +saveScene(id, body)
    +updateRoom(id, body)
    +selectStyle(id, styleId)
  }
  class ApiPersistence
  class LocalPersistence

  DesignProjectStore --> CommandHistory
  CommandHistory o-- SceneCommand
  SceneCommand <|.. MoveCommand
  SceneCommand <|.. SetRoomCommand
  SceneCommand <|.. SetFinishesCommand
  SceneCommand <|.. MacroCommand
  MacroCommand o-- SceneCommand
  DesignProjectStore --> ProjectPersistence
  ProjectPersistence <|-- ApiPersistence
  ProjectPersistence <|-- LocalPersistence
```

- **Command** — toda edición es un `SceneCommand`: por eso todo se deshace. `MacroCommand`
  (**Composite**) junta varias en un solo paso ("Otra distribución", "Vaciar cuarto").
- **Strategy** — `ProjectPersistence`: con cuenta el proyecto vive en la API; en la demo, en el
  navegador. El editor no sabe cuál usa.

## 2. Visor 3D: una fachada y sus piezas

```mermaid
classDiagram
  class SceneService {
    +setTool(id)
    +setCameraMode(mode)
    +setTimeOfDay(time)
    +viewFrom(preset)
    +capturePng(scale)
  }
  class RoomView
  class FurnitureView
  class LightingRig
  class PostFx
  class QualityGovernor
  class CameraDirector
  class RoomCamera {
    +setOrthographic(spanM)
    +apparentDistance(point)
  }
  class CameraMode {
    <<interface>>
  }
  class OrbitMode
  class WalkMode
  class ToolManager
  class ViewportTool {
    <<interface>>
    +down(e)
    +move(e)
    +up(e)
  }
  class SelectTool
  class RoomTool
  class PaintTool
  class MeasureTool
  class MountStrategy {
    <<interface>>
    +poseFor(ray, ctx)
  }
  class FloorMount
  class WallMount
  class SurfaceMount
  class FurnitureFactory
  class ParametricRenderer

  SceneService --> RoomView
  SceneService --> FurnitureView
  SceneService --> LightingRig
  SceneService --> CameraDirector
  SceneService --> RoomCamera
  CameraDirector --> RoomCamera
  SceneService --> ToolManager
  SceneService ..> PostFx : contorno
  CameraDirector o-- CameraMode
  CameraMode <|.. OrbitMode
  CameraMode <|.. WalkMode
  ToolManager o-- ViewportTool
  ViewportTool <|.. SelectTool
  ViewportTool <|.. RoomTool
  ViewportTool <|.. PaintTool
  ViewportTool <|.. MeasureTool
  MountStrategy <|.. FloorMount
  MountStrategy <|.. WallMount
  MountStrategy <|.. SurfaceMount
  FurnitureView --> FurnitureFactory
  FurnitureFactory --> ParametricRenderer
```

- **Facade** — `SceneService` es la única puerta de Angular a three.js.
- **State** — `ToolManager` entrega cada gesto a la herramienta activa; `CameraDirector`, a su modo.
- **Strategy** — `MountStrategy` decide dónde cae un mueble según se apoye en el piso, la pared u
  otro mueble; `LightingPreset` (día, tarde, noche) decide cómo se ilumina.
- **Flyweight** — `ParametricRenderer` comparte geometrías y materiales entre muebles iguales.
- `QualityGovernor` baja la calidad cuando el equipo no da; `PostFx` se carga aparte.
- `RoomCamera` es una sola cámara con dos proyecciones (perspectiva y, en la vista cenital,
  ortográfica): quien la usa no necesita saber cuál está activa (ADR-0022).

## 3. Servidor: puertos y adaptadores

```mermaid
classDiagram
  class ProjectsService {
    +create()
    +updateScene()
    +importScene()
  }
  class ProjectAccess {
    +own(actor, id)
    +toDto(project)
  }
  class SceneRules {
    +editedShell()
    +sanitizePlacements()
  }
  class VersionsService
  class SharingService
  class ProjectReports
  class HomesService {
    +setHome()
    +setPosition()
  }
  class IProjectRepository {
    <<interface>>
  }
  class ICatalogRepository {
    <<interface>>
  }
  class IAiClient {
    <<interface>>
  }
  class PrismaProjectRepository
  class HttpAiClient
  class CircuitBreaker {
    +allows()
    +success()
    +failure()
  }
  class PipelineService

  ProjectsService --> ProjectAccess
  ProjectsService --> SceneRules
  ProjectsService --> VersionsService
  ProjectsService --> SharingService
  ProjectsService --> ProjectReports
  ProjectsService --> HomesService
  ProjectAccess --> IProjectRepository
  SceneRules --> ICatalogRepository
  IProjectRepository <|.. PrismaProjectRepository
  IAiClient <|.. HttpAiClient
  HttpAiClient --> CircuitBreaker
  PipelineService --> IAiClient
  PipelineService --> IProjectRepository
```

- **Puertos y adaptadores** — los casos de uso solo conocen interfaces (`IProjectRepository`,
  `IAiClient`, `IFileStorage`, `IJobQueue`); Prisma, HTTP, S3 y BullMQ son adaptadores.
- **Facade** — `ProjectsService` reparte en colaboradores con una sola razón para cambiar.
- **Circuit Breaker** — si la IA no responde, deja de llamarla un rato en vez de apilar esperas.

## 4. Servicio de IA: proveedores intercambiables

```mermaid
classDiagram
  class RoomAnalyzer {
    <<interface>>
    +analyze(image, roomType)
  }
  class MockRoomAnalyzer
  class VisionRoomAnalyzer
  class ReplicateRoomAnalyzer
  class FallbackRoomAnalyzer
  class Budget {
    <<interface>>
    +take()
  }
  class DailyBudget
  class RedisDailyBudget
  class AnalysisCache {
    <<interface>>
  }
  class MemoryAnalysisCache
  class RedisAnalysisCache
  class LayoutEngine {
    <<interface>>
    +place(request)
  }
  class RulesLayoutEngine
  class LayoutCriterion {
    <<interface>>
    +rate(shell, pieces)
  }
  class Walkways
  class WindowsClear
  class Balance

  RoomAnalyzer <|.. MockRoomAnalyzer
  RoomAnalyzer <|.. VisionRoomAnalyzer
  RoomAnalyzer <|.. ReplicateRoomAnalyzer
  RoomAnalyzer <|.. FallbackRoomAnalyzer
  FallbackRoomAnalyzer o-- RoomAnalyzer
  VisionRoomAnalyzer --> Budget
  VisionRoomAnalyzer --> AnalysisCache
  Budget <|.. DailyBudget
  Budget <|.. RedisDailyBudget
  AnalysisCache <|.. MemoryAnalysisCache
  AnalysisCache <|.. RedisAnalysisCache
  LayoutEngine <|.. RulesLayoutEngine
  RulesLayoutEngine ..> LayoutCriterion
  LayoutCriterion <|.. Walkways
  LayoutCriterion <|.. WindowsClear
  LayoutCriterion <|.. Balance
```

- **Strategy** — quién analiza la foto se elige por configuración; `LayoutCriterion` puntúa una
  distribución por partes independientes.
- **Decorator** — `FallbackRoomAnalyzer` envuelve a otro analizador y responde con el local si falla.
- **Template Method** — `VisionRoomAnalyzer.analyze`: preparar la imagen, preguntar, validar, construir.

## 5. Lógica pura compartida (`packages/shared-types`)

Funciones sin estado que usan la web, la API y las pruebas, sin navegador ni base de datos:
`decorate` (decoración), `checkDesign` (revisión), `diffScenes` (comparar versiones),
`budgetStatus` y `totalsByCategory` (presupuesto), `arrangeHome`, `snapRoom` y `shareWall` (planta
conjunta de una vivienda), `snapMove` y `arrange` (alinear), las
operaciones de `room-edit` y los esquemas zod que definen el contrato entre los tres servicios.

## 6. Interfaz: piezas base y el editor por partes

```mermaid
classDiagram
  class EditorComponent {
    +viewMode
    +onGlobalKey(e)
  }
  class EditorToolbarComponent {
    +viewChange
    +review
    +present
  }
  class EditorPanelComponent {
    +showReview()
    +startSwap()
  }
  class ThreeViewportComponent
  class PlanEditorComponent
  class DialogComponent {
    +heading
    +open()
    +close()
  }
  class TooltipDirective
  class SegmentedComponent
  class RoomDimensionsDialogComponent
  class CalibrationDialogComponent
  class ShortcutsDialogComponent

  EditorComponent *-- EditorToolbarComponent
  EditorComponent *-- EditorPanelComponent
  EditorComponent *-- ThreeViewportComponent
  EditorComponent *-- PlanEditorComponent
  EditorComponent *-- RoomDimensionsDialogComponent
  EditorComponent *-- CalibrationDialogComponent
  EditorComponent *-- ShortcutsDialogComponent
  RoomDimensionsDialogComponent *-- DialogComponent
  CalibrationDialogComponent *-- DialogComponent
  ShortcutsDialogComponent *-- DialogComponent
  EditorToolbarComponent ..> SegmentedComponent
  EditorToolbarComponent ..> TooltipDirective
  ThreeViewportComponent ..> TooltipDirective
```

- **Composición** — el editor es el escenario y compone la barra y el panel. Estos no se conocen:
  lo que uno necesita del otro (abrir la revisión, cambiar un mueble) pasa por el editor.
- **Mediator** — por eso el editor hace de mediador entre la barra, el panel, el visor y los
  diálogos: cada pieza emite lo que quiere y el editor decide quién lo atiende.
- `DialogComponent`, `TooltipDirective` y `SegmentedComponent` son las piezas base de
  `shared/ui`: una sola implementación del título, el cierre, el foco y el teclado.

## 7. Modo Pro: dibujo técnico, normativa, obra e instalaciones (`shared-types/src/pro`)

Todo es lógica pura: la web dibuja la vista previa y calcula al momento; la API genera SVG, DXF y
PDF con el mismo código. `TechnicalSpec` (zod) es la ficha técnica que guarda cada proyecto.

```mermaid
classDiagram
  class TechnicalSpec {
    walls
    titleBlock
    sheet
    compliance
    rates
    installations
    section
  }
  class DrawingBuilder {
    +line() +polyline() +circle() +text() +dimension() +hatch()
    +build(title) Drawing
  }
  class Drawing {
    layers: Layer[]
  }
  class Entity {
    <<union>>
    Line | Polyline | Arc | Text | Dimension | Hatch
  }
  class SvgRenderer
  class DxfRenderer
  class PdfRenderer
  Drawing "1" *-- "*" Entity : Composite
  DrawingBuilder ..> Drawing : Builder
  SvgRenderer ..> Drawing : Visitor
  DxfRenderer ..> Drawing : Visitor
  PdfRenderer ..> Drawing : Visitor (API)

  class ComplianceRule {
    <<interface>>
    +id
    +group
    +applies(ctx) bool
    +evaluate(ctx) Finding[]
  }
  class ComplianceContext {
    profile: ComplianceProfile
    world: WalkWorld
    installations
    +reachable(d)
    +lighting()
    +daylight()
  }
  class ComplianceProfile {
    references
    clearPathM
    targetLux
  }
  ComplianceRule ..> ComplianceContext : Specification
  ComplianceContext --> ComplianceProfile
  class clearPath
  class illuminance
  class outletSpacing
  class circuitLoad
  ComplianceRule <|.. clearPath
  ComplianceRule <|.. illuminance
  ComplianceRule <|.. outletSpacing
  ComplianceRule <|.. circuitLoad

  class WasteStrategy {
    <<interface>>
    +wasteFor(material, surface) number
  }
  class PATTERN_WASTE
  WasteStrategy <|.. PATTERN_WASTE : Strategy
  class computeTakeoff {
    measureRoom()
    activityWithRate()
    purchasesFor()
  }
  computeTakeoff ..> WasteStrategy

  class proposeInstallations
  class assignCircuits
  class loadSchedule
  class drawSymbol {
    <<factory>>
    kind → símbolo
  }
  proposeInstallations ..> assignCircuits
  loadSchedule ..> assignCircuits
  DrawingBuilder <.. drawSymbol

  TechnicalSpec <.. computeTakeoff
  TechnicalSpec <.. ComplianceContext
  TechnicalSpec <.. proposeInstallations
```

El chat usa estas mismas funciones como herramientas de solo lectura de la `DesignToolbox`
(`estimate_works`, `check_compliance`, `suggest_installations`, `list_drawings`, en `pro/assistant.ts`).

## 8. Render en Blender: cola propia y nodo opcional (ADR-0036)

```mermaid
classDiagram
  class RenderStudioComponent {
    +sendToBlender()
    +checkNode()
  }
  class RenderGalleryComponent {
    +track(render)
    +open()
  }
  class RendersApi {
    +renderInBlender(projectId, spec, lights, scene)
    +renderNode()
  }
  class BlenderRendersService {
    +create(actor, projectId, spec, lights, scene)
  }
  class RendersService {
    +remove()
  }
  class RenderJobsListener {
    -progress()
    -settle()
    +reconcile()
  }
  class IRenderJobQueue {
    <<interface>>
    +enqueue(job)
    +node()
    +info(id)
    +cancel(id)
  }
  class BullMqRenderJobQueue
  class IQuota {
    <<interface>>
  }
  class RenderJobHandler {
    +handle(job, report, cancelled)
  }
  class BlenderRunner {
    +run(scene, plan, out, onProgress, isCancelled)
  }
  class S3Storage
  class look {
    <<module>>
    +recipe_for(role, material)
    +camera_sees_through_back()
    +bevel_radius()
    +inside_room()
  }

  RenderStudioComponent --> RendersApi
  RenderGalleryComponent --> RendersApi
  RendersApi ..> BlenderRendersService : POST /renders/blender
  BlenderRendersService --> IRenderJobQueue
  BlenderRendersService --> IQuota
  RendersService --> IRenderJobQueue
  IRenderJobQueue <|.. BullMqRenderJobQueue
  RenderJobsListener --> IQuota
  BullMqRenderJobQueue ..> RenderJobHandler : cola render-jobs
  RenderJobHandler --> BlenderRunner
  RenderJobHandler --> S3Storage
  BlenderRunner ..> look : render_scene.py
```

- **Puertos y adaptadores** — la API solo conoce `IRenderJobQueue`; BullMQ es el adaptador. El nodo
  Python no escribe en Postgres: `RenderJobsListener` (proceso worker) es quien pasa el `Render` a
  `ready` o `failed` y publica el avance.
- **Inyección del comando** — `BlenderRunner` recibe qué ejecutar; en las pruebas es un Blender
  simulado (`tests/fake_blender.py`) con la misma salida.
- **Funciones puras** — `look.py` decide materiales, luces y qué ve la cámara sin depender de `bpy`,
  así se prueba con pytest y lo usa `render_scene.py` dentro de Blender.
