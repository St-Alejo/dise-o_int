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
  class HomesService
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
`budgetStatus` y `totalsByCategory` (presupuesto), `snapMove` y `arrange` (alinear), las
operaciones de `room-edit` y los esquemas zod que definen el contrato entre los tres servicios.
