/** Dobles de prueba en memoria que implementan los puertos (arquitectura hexagonal). */
import { randomUUID } from 'node:crypto';
import type {
  AnalyzeReferenceRequest,
  AnalyzeReferenceResponse,
  NluParseRequest,
  NluParseResponse,
  RankRecommendationsRequest,
  RankRecommendationsResponse,
  AnalyzeRoomRequest,
  AnalyzeRoomResponse,
  CatalogFilters,
  GenerateStyleRequest,
  GenerateStyleResponse,
  JobKind,
  JobProgressEvent,
  PlaceFurnitureRequest,
  PlaceFurnitureResponse,
} from '@interiores/shared-types';
import { createRectangularShell } from '@interiores/shared-types';
import { NotFoundError, QuotaExceededError, StaleRevisionError } from '../src/common/errors.js';
import type { AppConfig } from '../src/config/env.js';
import type {
  CatalogRecord,
  IAiClient,
  ICatalogRepository,
  IJobQueue,
  IProgressBroker,
  IProjectRepository,
  IQuota,
  JobPayloads,
  PreviewRecord,
  RecommendationRecord,
  ProjectPatch,
  ProjectRecord,
  UpdateOptions,
  VersionRecord,
} from '../src/ports/index.js';

export const testConfig = {
  NODE_ENV: 'test',
  UPLOAD_MAX_MB: 15,
  GENERATIONS_PER_DAY: 10,
  RETENTION_HOURS: 24,
  MEDIA_SIGNING_SECRET: 'x'.repeat(40),
  MEDIA_URL_TTL_SECONDS: 3600,
} as unknown as AppConfig;

export class InMemoryProjectRepository implements IProjectRepository {
  projects = new Map<string, ProjectRecord>();
  versions: VersionRecord[] = [];
  previews: PreviewRecord[] = [];
  shares: { projectId: string; token: string; revoked: boolean }[] = [];
  audits: unknown[] = [];
  private clock = 0;
  private now = () => new Date(Date.UTC(2026, 0, 1) + ++this.clock * 1000);

  async create(data: Omit<ProjectRecord, 'createdAt' | 'updatedAt' | 'revision' | 'lastError'>) {
    const rec: ProjectRecord = { ...data, revision: 0, lastError: null, createdAt: this.now(), updatedAt: this.now() };
    this.projects.set(rec.id, structuredClone(rec));
    return structuredClone(rec);
  }
  async findById(id: string) {
    const p = this.projects.get(id);
    return p ? structuredClone(p) : null;
  }
  async listByOwner(ownerId: string) {
    return [...this.projects.values()].filter((p) => p.ownerId === ownerId).map((p) => structuredClone(p));
  }
  async update(id: string, patch: ProjectPatch, opts: UpdateOptions = {}) {
    const p = this.projects.get(id);
    if (!p) throw new NotFoundError('no existe');
    if (opts.expectedRevision !== undefined && p.revision !== opts.expectedRevision) throw new StaleRevisionError('stale');
    Object.assign(p, structuredClone(patch), { updatedAt: this.now() });
    if (opts.bumpRevision) p.revision++;
    return structuredClone(p);
  }
  async delete(id: string) {
    this.projects.delete(id);
  }
  async addVersion(projectId: string, note: string | null) {
    const p = this.projects.get(projectId)!;
    const v: VersionRecord = {
      id: randomUUID(),
      projectId,
      number: this.versions.filter((x) => x.projectId === projectId).length + 1,
      note,
      roomShell: structuredClone(p.roomShell),
      placements: structuredClone(p.placements),
      finishes: structuredClone(p.finishes),
      selectedStyleId: p.selectedStyleId,
      createdAt: this.now(),
    };
    this.versions.push(v);
    p.saved = true;
    return v;
  }
  async listVersions(projectId: string) {
    return this.versions.filter((v) => v.projectId === projectId).reverse();
  }
  async getVersion(projectId: string, versionId: string) {
    return this.versions.find((v) => v.projectId === projectId && v.id === versionId) ?? null;
  }
  async createPreview(data: Omit<PreviewRecord, 'id' | 'createdAt' | 'error'>) {
    const rec: PreviewRecord = { ...data, id: randomUUID(), error: null, createdAt: this.now() };
    this.previews.push(rec);
    return { ...rec };
  }
  async updatePreview(id: string, patch: Partial<PreviewRecord>) {
    const p = this.previews.find((x) => x.id === id)!;
    Object.assign(p, patch);
    return { ...p };
  }
  async listPreviews(projectId: string) {
    return this.previews.filter((p) => p.projectId === projectId).map((p) => ({ ...p }));
  }
  async findPreviewByCacheKey(projectId: string, cacheKey: string) {
    const found = this.previews.filter((p) => p.projectId === projectId && p.cacheKey === cacheKey && p.status !== 'failed');
    return found.at(-1) ?? null;
  }
  async createShareLink(projectId: string, token: string) {
    this.shares.push({ projectId, token, revoked: false });
  }
  async replaceShareLink(projectId: string, token: string) {
    if (!this.projects.has(projectId)) throw new NotFoundError('no existe');
    await this.revokeShareLinks(projectId);
    await this.createShareLink(projectId, token);
    this.projects.get(projectId)!.saved = true;
  }
  async revokeShareLinks(projectId: string) {
    this.shares.filter((s) => s.projectId === projectId).forEach((s) => (s.revoked = true));
  }
  async hasActiveShareLink(projectId: string) {
    return this.shares.some((s) => s.projectId === projectId && !s.revoked);
  }
  async findProjectIdByShareToken(token: string) {
    return this.shares.find((s) => s.token === token && !s.revoked)?.projectId ?? null;
  }
  async listExpiredUnsaved(before: Date, limit: number) {
    return [...this.projects.values()].filter((p) => !p.saved && p.createdAt < before).slice(0, limit).map((p) => p.id);
  }
  async existingIds(ids: string[]) {
    return ids.filter((id) => this.projects.has(id));
  }
  recommendations: RecommendationRecord[] = [];
  async addRecommendation(data: Omit<RecommendationRecord, 'id' | 'createdAt'>) {
    const rec: RecommendationRecord = { ...data, id: randomUUID(), createdAt: this.now() };
    this.recommendations.push(rec);
    return rec;
  }
  async findRecommendation(projectId: string, id: string) {
    return this.recommendations.find((r) => r.projectId === projectId && r.id === id) ?? null;
  }
  async listRecommendations(f: { projectId?: string; ownerId?: string; actions?: RecommendationRecord['action'][]; limit: number }) {
    return this.recommendations
      .filter((r) => (!f.projectId || r.projectId === f.projectId) && (!f.ownerId || r.ownerId === f.ownerId) && (!f.actions || f.actions.includes(r.action)))
      .reverse()
      .slice(0, f.limit);
  }
  async auditJob(entry: unknown) {
    this.audits.push(entry);
  }
}

export function catalogItem(overrides: Partial<CatalogRecord> = {}): CatalogRecord {
  return {
    id: 'sofa-test',
    name: 'Sofá test',
    category: 'sofa',
    subcategory: null,
    styleTags: ['moderno'],
    roomTypes: ['living'],
    widthM: 2,
    heightM: 0.8,
    depthM: 0.9,
    mount: 'floor',
    modelKey: 'catalog/sofa-test.abc12345.glb',
    thumbnailKey: null,
    price: 500,
    currency: 'USD',
    productUrl: 'https://example.com/sofa',
    license: 'cc0',
    attribution: null,
    source: 'procedural:sofa-block',
    tags: [],
    synonyms: [],
    description: null,
    spec: null,
    active: true,
    ...overrides,
  };
}

export class InMemoryCatalogRepository implements ICatalogRepository {
  constructor(public items: CatalogRecord[] = [catalogItem(), catalogItem({ id: 'lamp', name: 'Lámpara', category: 'lighting', mount: 'ceiling', widthM: 0.4, heightM: 0.9, depthM: 0.4, price: 100 })]) {}
  async listActive() {
    return this.items.filter((i) => i.active);
  }
  async search(q: CatalogFilters) {
    return this.items.filter((i) => (!q.category || i.category === q.category) && (!q.roomType || i.roomTypes.includes(q.roomType)));
  }
  async findById(id: string) {
    return this.items.find((i) => i.id === id) ?? null;
  }
  async findByIds(ids: string[]) {
    return this.items.filter((i) => ids.includes(i.id));
  }
  async upsert(item: CatalogRecord) {
    this.items = [...this.items.filter((i) => i.id !== item.id), item];
  }
  async count() {
    return this.items.length;
  }
}

export class FakeQueue implements IJobQueue {
  jobs: { kind: JobKind; jobId: string; data: unknown }[] = [];
  async enqueue<K extends JobKind>(kind: K, jobId: string, data: JobPayloads[K]) {
    if (!this.jobs.some((j) => j.jobId === jobId)) this.jobs.push({ kind, jobId, data });
    return jobId;
  }
  async ping() {}
}

export class FakeBroker implements IProgressBroker {
  events: JobProgressEvent[] = [];
  async publish(e: JobProgressEvent) {
    this.events.push(e);
  }
  async history(projectId: string) {
    return this.events.filter((e) => e.projectId === projectId);
  }
  async subscribe() {
    return async () => undefined;
  }
}

export class FakeQuota implements IQuota {
  used = new Map<string, number>();
  constructor(private readonly limit = 10) {}
  async consume(userId: string, amount: number) {
    const used = (this.used.get(userId) ?? 0) + amount;
    if (used > this.limit) throw new QuotaExceededError('límite');
    this.used.set(userId, used);
    return { used, limit: this.limit };
  }
  async refund(userId: string, amount: number) {
    this.used.set(userId, Math.max(0, (this.used.get(userId) ?? 0) - amount));
  }
}

export class FakeAi implements IAiClient {
  failStyles = new Set<string>();
  calls: string[] = [];
  /** Lo que un modelo de visión añadiría al análisis (inventario, colores). */
  seen: Partial<Pick<AnalyzeRoomResponse, 'detectedObjects' | 'suggestions'>> = {};
  layoutRequests: PlaceFurnitureRequest[] = [];
  async analyzeRoom(_req: AnalyzeRoomRequest): Promise<AnalyzeRoomResponse> {
    this.calls.push('analyze');
    return { roomShell: createRectangularShell(4, 3.5, 2.6), detectedObjects: [], provider: 'fake', durationMs: 1, ...this.seen };
  }
  async generateStyle(req: GenerateStyleRequest): Promise<GenerateStyleResponse> {
    this.calls.push(`style:${req.styleId}`);
    if (this.failStyles.has(req.styleId)) throw new Error('fallo simulado');
    return { imageKey: req.outputKey, provider: 'fake', durationMs: 1 };
  }
  async placeFurniture(req: PlaceFurnitureRequest): Promise<PlaceFurnitureResponse> {
    this.calls.push('layout');
    this.layoutRequests.push(req);
    const sofa = req.candidates.find((c) => c.category === 'sofa');
    return {
      placements: sofa
        ? [{ id: 'auto-1', catalogItemId: sofa.id, position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: false }]
        : [],
      unplaced: [],
      score: 1,
      engine: 'fake',
    };
  }
  /** Respuestas del modelo de intención por texto; lo demás es "other" sin confianza. */
  nlu = new Map<string, Partial<NluParseResponse>>();
  nluDown = false;
  async parseIntent(req: NluParseRequest): Promise<NluParseResponse> {
    this.calls.push(`nlu:${req.text}`);
    if (this.nluDown) throw new Error('IA caída');
    const hit = [...this.nlu].find(([k]) => req.text.includes(k))?.[1] ?? {};
    return { intent: 'other', confidence: 0.2, alternatives: [], model: 'fake', ...hit, slots: { colors: [], fullHeight: false, ...hit.slots } };
  }
  /** Sin valor: puntúa con la nota de oficio (como el servicio sin historial suficiente). */
  rank: ((req: RankRecommendationsRequest) => RankRecommendationsResponse) | Error | null = null;
  async rankRecommendations(req: RankRecommendationsRequest): Promise<RankRecommendationsResponse> {
    this.calls.push('rank');
    if (this.rank instanceof Error) throw this.rank;
    if (this.rank) return this.rank(req);
    return { scores: Object.fromEntries(req.candidates.map((c) => [c.id, c.prior])), model: 'prior', samples: req.history.length };
  }
  reference: AnalyzeReferenceResponse = {
    style: 'escandinavo',
    palette: ['#a9d4ee', '#9bd3b0', '#f4f4f1'],
    floor: { kind: 'tile', pattern: 'mosaic', colors: ['#a9d4ee', '#9bd3b0'], gloss: 0.85 },
    wallColor: '#f4f4f1',
    objects: ['sofa', 'rug'],
    mood: 'calida',
    level: 'media',
    source: 'vision',
  };
  async analyzeReference(req: AnalyzeReferenceRequest): Promise<AnalyzeReferenceResponse> {
    this.calls.push(`reference:${req.imageKey}`);
    return this.reference;
  }
  async ping() {}
}
