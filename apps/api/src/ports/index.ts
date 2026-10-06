/**
 * Puertos (arquitectura hexagonal). Los casos de uso dependen SOLO de estas interfaces;
 * los adaptadores concretos (Prisma, S3, BullMQ, Redis, HTTP a la IA) se enlazan en los
 * módulos Nest, y los tests usan implementaciones en memoria.
 */
import type { Readable } from 'node:stream';
import type {
  AnalyzeRoomRequest,
  AnalyzeRoomResponse,
  CatalogCategory,
  CatalogQuery,
  FurniturePlacement,
  GenerateStyleRequest,
  GenerateStyleResponse,
  JobKind,
  JobProgressEvent,
  PlaceFurnitureRequest,
  PlaceFurnitureResponse,
  ProjectStatus,
  RoomShell,
  RoomType,
  StyleId,
} from '@interiores/shared-types';

// ---------------------------------------------------------------------------
// Registros de persistencia (el "estado" del agregado DesignProject)
// ---------------------------------------------------------------------------
export interface ProjectRecord {
  id: string;
  ownerId: string;
  name: string;
  roomType: RoomType;
  status: ProjectStatus;
  lastError: string | null;
  photoKey: string | null;
  photoHash: string | null;
  thumbKey: string | null;
  roomShell: RoomShell | null;
  placements: FurniturePlacement[];
  selectedStyleId: StyleId | null;
  requestedStyles: StyleId[];
  saved: boolean;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface VersionRecord {
  id: string;
  projectId: string;
  number: number;
  note: string | null;
  roomShell: RoomShell | null;
  placements: FurniturePlacement[];
  selectedStyleId: StyleId | null;
  createdAt: Date;
}

export interface PreviewRecord {
  id: string;
  projectId: string;
  styleId: StyleId;
  promptStrength: number;
  status: 'pending' | 'ready' | 'failed';
  imageKey: string | null;
  cacheKey: string;
  provider: string | null;
  error: string | null;
  createdAt: Date;
}

export interface CatalogRecord {
  id: string;
  name: string;
  category: CatalogCategory;
  subcategory: string | null;
  styleTags: StyleId[];
  roomTypes: RoomType[];
  widthM: number;
  heightM: number;
  depthM: number;
  mount: 'floor' | 'ceiling';
  modelKey: string;
  thumbnailKey: string | null;
  price: number | null;
  currency: string;
  productUrl: string | null;
  license: 'cc0' | 'cc-by' | 'proprietary' | 'affiliate';
  attribution: string | null;
  source: string;
  active: boolean;
}

export type ProjectPatch = Partial<
  Pick<
    ProjectRecord,
    | 'name'
    | 'status'
    | 'lastError'
    | 'photoKey'
    | 'photoHash'
    | 'thumbKey'
    | 'roomShell'
    | 'placements'
    | 'selectedStyleId'
    | 'requestedStyles'
    | 'saved'
  >
>;

export interface UpdateOptions {
  /** Si se indica, la actualización solo ocurre si la revisión actual coincide (409 si no). */
  expectedRevision?: number;
  /** Incrementa la revisión (cambios de contenido de la escena). */
  bumpRevision?: boolean;
}

export interface IProjectRepository {
  create(data: Omit<ProjectRecord, 'createdAt' | 'updatedAt' | 'revision' | 'lastError'>): Promise<ProjectRecord>;
  findById(id: string): Promise<ProjectRecord | null>;
  listByOwner(ownerId: string): Promise<ProjectRecord[]>;
  update(id: string, patch: ProjectPatch, opts?: UpdateOptions): Promise<ProjectRecord>;
  delete(id: string): Promise<void>;

  addVersion(projectId: string, note: string | null): Promise<VersionRecord>;
  listVersions(projectId: string): Promise<VersionRecord[]>;
  getVersion(projectId: string, versionId: string): Promise<VersionRecord | null>;

  createPreview(data: Omit<PreviewRecord, 'id' | 'createdAt' | 'error'>): Promise<PreviewRecord>;
  updatePreview(id: string, patch: Partial<Pick<PreviewRecord, 'status' | 'imageKey' | 'provider' | 'error'>>): Promise<PreviewRecord>;
  listPreviews(projectId: string): Promise<PreviewRecord[]>;
  findPreviewByCacheKey(projectId: string, cacheKey: string): Promise<PreviewRecord | null>;

  createShareLink(projectId: string, token: string): Promise<void>;
  /** Revoca los enlaces activos, crea uno nuevo y marca el proyecto como guardado, todo atómico. */
  replaceShareLink(projectId: string, token: string): Promise<void>;
  revokeShareLinks(projectId: string): Promise<void>;
  hasActiveShareLink(projectId: string): Promise<boolean>;
  findProjectIdByShareToken(token: string): Promise<string | null>;

  /** Proyectos no guardados cuya retención expiró (privacidad: §8.4). */
  listExpiredUnsaved(before: Date, limit: number): Promise<string[]>;
  /** De los ids dados, devuelve los que existen en la base de datos (barrido de huérfanos). */
  existingIds(ids: string[]): Promise<string[]>;

  auditJob(entry: {
    projectId: string;
    jobId: string;
    kind: JobKind;
    status: 'started' | 'completed' | 'failed';
    attempts: number;
    error?: string;
    requestId?: string;
    durationMs?: number;
  }): Promise<void>;
}

export interface ICatalogRepository {
  search(query: CatalogQuery): Promise<CatalogRecord[]>;
  findById(id: string): Promise<CatalogRecord | null>;
  findByIds(ids: string[]): Promise<CatalogRecord[]>;
  upsert(item: CatalogRecord): Promise<void>;
  count(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Almacenamiento de archivos (S3 / R2 / SeaweedFS / memoria)
// ---------------------------------------------------------------------------
export interface StoredObject {
  body: Readable;
  contentType: string;
  contentLength?: number;
  etag?: string;
}

export interface IFileStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  getBuffer(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  /** Borrado real (no soft-delete) de todos los objetos bajo un prefijo. */
  deletePrefix(prefix: string): Promise<number>;
  /** Recorre los objetos bajo un prefijo (clave + fecha de última modificación). */
  listObjects(prefix: string): AsyncIterable<{ key: string; lastModified: Date }>;
  ensureBucket(): Promise<void>;
  ping(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Servicio de IA (adaptador HTTP hacia FastAPI)
// ---------------------------------------------------------------------------
export interface AiCallContext {
  requestId?: string;
  signal?: AbortSignal;
}

export interface IAiClient {
  analyzeRoom(req: AnalyzeRoomRequest, ctx?: AiCallContext): Promise<AnalyzeRoomResponse>;
  generateStyle(req: GenerateStyleRequest, ctx?: AiCallContext): Promise<GenerateStyleResponse>;
  placeFurniture(req: PlaceFurnitureRequest, ctx?: AiCallContext): Promise<PlaceFurnitureResponse>;
  ping(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Cola de trabajos y progreso en vivo
// ---------------------------------------------------------------------------
export interface AnalyzeRoomJob {
  projectId: string;
  styles: StyleId[];
  promptStrength: number;
  requestId?: string;
}
export interface GenerateStylesJob {
  projectId: string;
  previewIds: string[];
  requestId?: string;
}
export interface BuildSceneJob {
  projectId: string;
  styleId: StyleId | null;
  keepLocked: boolean;
  requestId?: string;
}
export interface JobPayloads {
  'analyze-room': AnalyzeRoomJob;
  'generate-styles': GenerateStylesJob;
  'build-scene': BuildSceneJob;
}

export interface IJobQueue {
  /** Encola de forma idempotente: si ya hay un job activo con ese id no se duplica. */
  enqueue<K extends JobKind>(kind: K, jobId: string, data: JobPayloads[K]): Promise<string>;
  ping(): Promise<void>;
}

export interface IProgressBroker {
  publish(event: JobProgressEvent): Promise<void>;
  history(projectId: string): Promise<JobProgressEvent[]>;
  /** Suscripción a todos los proyectos; devuelve la función para desuscribirse. */
  subscribe(handler: (event: JobProgressEvent) => void): Promise<() => Promise<void>>;
}

export interface IQuota {
  /** Consume `amount` generaciones del día; lanza QuotaExceededError si no alcanza. */
  consume(userId: string, amount: number): Promise<{ used: number; limit: number }>;
  refund(userId: string, amount: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Tokens de inyección
// ---------------------------------------------------------------------------
export const PROJECT_REPOSITORY = Symbol('IProjectRepository');
export const CATALOG_REPOSITORY = Symbol('ICatalogRepository');
export const FILE_STORAGE = Symbol('IFileStorage');
export const AI_CLIENT = Symbol('IAiClient');
export const JOB_QUEUE = Symbol('IJobQueue');
export const PROGRESS_BROKER = Symbol('IProgressBroker');
export const QUOTA = Symbol('IQuota');
export const APP_CONFIG = Symbol('AppConfig');
export const REDIS = Symbol('Redis');
