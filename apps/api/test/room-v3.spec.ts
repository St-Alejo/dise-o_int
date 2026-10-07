/** Fase 1 (v3): medidas exactas del cuarto, medidas por pieza, montajes en pared/superficie y acabados. */
import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { STYLE_FINISHES, createRectangularShell, type FurniturePlacement } from '@interiores/shared-types';
import { StaleRevisionError, ValidationError } from '../src/common/errors.js';
import { PhotoProcessor } from '../src/infrastructure/imaging/photo-processor.js';
import { MediaUrlSigner } from '../src/infrastructure/media/media-url-signer.js';
import { MemoryFileStorage } from '../src/infrastructure/storage/memory-file-storage.js';
import { PipelineService } from '../src/modules/jobs/pipeline.service.js';
import { ProjectsService } from '../src/modules/projects/projects.service.js';
import {
  FakeAi,
  FakeBroker,
  FakeQueue,
  FakeQuota,
  InMemoryCatalogRepository,
  InMemoryProjectRepository,
  catalogItem,
  testConfig,
} from './fakes.js';

const photo = () => sharp({ create: { width: 640, height: 480, channels: 3, background: '#d8cbb3' } }).jpeg().toBuffer();
const at = (x: number, z: number) => ({ x, y: 0, z });
const place = (id: string, catalogItemId: string, x: number, z: number, extra: Partial<FurniturePlacement> = {}): FurniturePlacement => ({
  id,
  catalogItemId,
  position: at(x, z),
  rotationY: 0,
  lockedByUser: true,
  ...extra,
});

describe('Fase 1 — cuarto a medida y piezas personalizables', () => {
  let repo: InMemoryProjectRepository;
  let catalog: InMemoryCatalogRepository;
  let quota: FakeQuota;
  let service: ProjectsService;
  const alice = { userId: 'alice' };

  beforeEach(() => {
    repo = new InMemoryProjectRepository();
    catalog = new InMemoryCatalogRepository([
      catalogItem(), // sofá 2 × 0.8 × 0.9, sin spec → ±30 %
      catalogItem({
        id: 'mesa-noche',
        name: 'Mesa de noche',
        category: 'table',
        subcategory: 'nightstand',
        widthM: 0.5,
        heightM: 0.55,
        depthM: 0.4,
        spec: { allowsUnder: false },
      }),
      catalogItem({
        id: 'lampara-mesa',
        name: 'Lámpara de mesa',
        category: 'lighting',
        subcategory: 'table-lamp',
        mount: 'surface',
        widthM: 0.3,
        heightM: 0.5,
        depthM: 0.3,
        spec: { resize: { y: [0.3, 0.8] } },
      }),
      catalogItem({
        id: 'cuadro',
        name: 'Cuadro',
        category: 'wall-decor',
        mount: 'wall',
        widthM: 0.8,
        heightM: 0.6,
        depthM: 0.04,
        spec: { elevationDefaultM: 1.3 },
      }),
    ]);
    quota = new FakeQuota(10);
    service = new ProjectsService(
      repo,
      catalog,
      new MemoryFileStorage(),
      new FakeQueue(),
      new FakeBroker(),
      quota,
      testConfig,
      new PhotoProcessor(),
      new MediaUrlSigner(testConfig),
    );
  });

  async function readyProject() {
    const p = await service.create(alice, { name: 'Cuarto', roomType: 'bedroom' }, await photo());
    await repo.update(p.id, { roomShell: createRectangularShell(4, 3.5, 2.6), status: 'ready' }, { bumpRevision: true });
    return service.get(alice, p.id);
  }

  describe('PUT room: medidas exactas', () => {
    it('cambia ancho, largo y alto por separado y confirma la escala', async () => {
      const p = await readyProject();
      const updated = await service.updateRoom(alice, p.id, { revision: p.revision, widthM: 5.25, depthM: 3.1, heightM: 2.45 });
      expect(updated.roomShell).toMatchObject({ widthM: 5.25, depthM: 3.1, heightM: 2.45, scaleConfidence: 1, needsCalibration: false });
      expect(updated.revision).toBe(p.revision + 1);
    });

    it('reacomoda (sin borrar) los muebles que quedarían fuera del cuarto nuevo', async () => {
      let p = await readyProject();
      p = await service.updateScene(alice, p.id, { revision: p.revision, furniturePlacements: [place('s', 'sofa-test', 3, 3)] });
      const updated = await service.updateRoom(alice, p.id, { revision: p.revision, widthM: 2.5, depthM: 2.2, heightM: 2.5 });
      expect(updated.furniturePlacements).toHaveLength(1);
      const sofa = updated.furniturePlacements[0]!;
      expect(sofa.position.x + 1).toBeLessThanOrEqual(2.5 + 1e-9);
      expect(sofa.position.z + 0.45).toBeLessThanOrEqual(2.2 + 1e-9);
    });

    it('acepta puertas y ventanas explícitas y rechaza las que no caben (422)', async () => {
      const p = await readyProject();
      const door = { id: 'd1', type: 'door' as const, wallId: 'w-left', widthM: 0.9, heightM: 2.1, offsetM: 1.2, sillHeightM: 0 };
      const ok = await service.updateRoom(alice, p.id, { revision: p.revision, widthM: 4, depthM: 3.5, heightM: 2.6, openings: [door] });
      expect(ok.roomShell!.openings).toEqual([door]);
      await expect(
        service.updateRoom(alice, p.id, { revision: ok.revision, widthM: 4, depthM: 3.5, heightM: 2.6, openings: [{ ...door, offsetM: 3.4 }] }),
      ).rejects.toThrow(ValidationError);
    });

    it('respeta el control de concurrencia (409 con revisión vieja)', async () => {
      const p = await readyProject();
      await service.updateRoom(alice, p.id, { revision: p.revision, widthM: 4.5, depthM: 3.5, heightM: 2.6 });
      await expect(service.updateRoom(alice, p.id, { revision: p.revision, widthM: 5, depthM: 3.5, heightM: 2.6 })).rejects.toThrow(
        StaleRevisionError,
      );
    });
  });

  describe('medidas propias por pieza', () => {
    it('acota las medidas pedidas a los rangos (por defecto ±30 %) y usa el tamaño nuevo para el clamp', async () => {
      const p = await readyProject();
      const updated = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [place('s', 'sofa-test', 0, 2, { dimensionsM: { x: 9, y: 0.8, z: 0.9 } })],
      });
      const sofa = updated.furniturePlacements[0]!;
      expect(sofa.dimensionsM!.x).toBeCloseTo(2.6); // 2 m × 1.3
      expect(sofa.position.x).toBeCloseTo(1.3); // la mitad del ancho nuevo: pegado a la pared izquierda
    });

    it('un eje sin rango en el spec no se puede cambiar', async () => {
      const p = await readyProject();
      const updated = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [place('l', 'lampara-mesa', 1, 1, { dimensionsM: { x: 1, y: 0.7, z: 1 } })],
      });
      expect(updated.furniturePlacements[0]!.dimensionsM).toEqual({ x: 0.3, y: 0.7, z: 0.3 });
    });
  });

  describe('montajes v3', () => {
    it('un objeto sobre una superficie queda a la altura del tope de su soporte', async () => {
      const p = await readyProject();
      const updated = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [place('mn', 'mesa-noche', 1, 1), place('lm', 'lampara-mesa', 1, 1, { supportId: 'mn' })],
      });
      const lamp = updated.furniturePlacements.find((x) => x.id === 'lm')!;
      expect(lamp.supportId).toBe('mn');
      expect(lamp.position.y).toBeCloseTo(0.55);
    });

    it('si el soporte no existe, el objeto cae al piso y se descarta la referencia', async () => {
      const p = await readyProject();
      const updated = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [place('lm', 'lampara-mesa', 1, 1, { supportId: 'fantasma', position: { x: 1, y: 3, z: 1 } })],
      });
      const lamp = updated.furniturePlacements[0]!;
      expect(lamp.supportId).toBeUndefined();
      expect(lamp.position.y).toBe(0);
    });

    it('un cuadro va a la altura pedida (o la del catálogo) sin atravesar el techo, y valida la pared', async () => {
      const p = await readyProject();
      const updated = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [
          place('c1', 'cuadro', 2, 0.02, { wallId: 'w-back', elevationM: 5 }),
          place('c2', 'cuadro', 1, 0.02, { wallId: 'w-inventada' }),
        ],
      });
      const [c1, c2] = updated.furniturePlacements;
      expect(c1!.position.y).toBeCloseTo(2.0); // 2.6 − 0.6
      expect(c1!.wallId).toBe('w-back');
      expect(c2!.position.y).toBeCloseTo(1.3); // elevationDefaultM
      expect(c2!.wallId).toBeUndefined();
    });

    it('los campos de montaje que no aplican se limpian (un sofá no tiene soporte ni pared)', async () => {
      const p = await readyProject();
      const updated = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [place('s', 'sofa-test', 2, 2, { supportId: 'x', wallId: 'w-back', elevationM: 1 })],
      });
      const sofa = updated.furniturePlacements[0]!;
      expect(sofa).not.toHaveProperty('supportId');
      expect(sofa).not.toHaveProperty('wallId');
      expect(sofa).not.toHaveProperty('elevationM');
    });
  });

  describe('acabados del cuarto', () => {
    it('se guardan, se versionan y se restauran', async () => {
      let p = await readyProject();
      p = await service.updateScene(alice, p.id, { revision: p.revision, furniturePlacements: [], finishes: STYLE_FINISHES.industrial });
      expect(p.finishes).toEqual(STYLE_FINISHES.industrial);
      p = await service.saveVersion(alice, p.id, 'industrial');
      p = await service.updateScene(alice, p.id, { revision: p.revision, furniturePlacements: [], finishes: null });
      expect(p.finishes).toBeNull();
      const restored = await service.restoreVersion(alice, p.id, p.versions[0]!.id);
      expect(restored.finishes).toEqual(STYLE_FINISHES.industrial);
    });

    it('rechaza materiales inexistentes o en la superficie equivocada (422)', async () => {
      const p = await readyProject();
      await expect(
        service.updateScene(alice, p.id, {
          revision: p.revision,
          furniturePlacements: [],
          finishes: { floor: 'paint-white', walls: { all: 'paint-white' }, ceiling: 'paint-white' },
        }),
      ).rejects.toThrow(/piso/);
    });
  });

  describe('medidas al crear el proyecto', () => {
    it('se guardan y el pipeline las aplica sobre la estimación de la IA', async () => {
      const created = await service.create(
        alice,
        { name: 'A medida', roomType: 'living', widthM: '5.2', depthM: '4,1', heightM: '2.7' },
        await photo(),
      );
      const record = await repo.findById(created.id);
      expect(record!.requestedRoom).toEqual({ widthM: 5.2, depthM: 4.1, heightM: 2.7 });

      const pipeline = new PipelineService(repo, catalog, new FakeAi(), new FakeBroker(), quota);
      await pipeline.analyzeRoom(
        { projectId: created.id, styles: ['moderno'], promptStrength: 0.6 },
        { jobId: 'j', kind: 'analyze-room', isFinalAttempt: true },
      );
      const after = await repo.findById(created.id);
      expect(after!.roomShell).toMatchObject({ widthM: 5.2, depthM: 4.1, heightM: 2.7, scaleConfidence: 1 });
      // Las aberturas detectadas se conservan con el tamaño real.
      expect(after!.roomShell!.openings.length).toBeGreaterThan(0);
    });

    it('sin medidas, se usa la estimación tal cual', async () => {
      const created = await service.create(alice, { name: 'Estimado', roomType: 'living' }, await photo());
      expect((await repo.findById(created.id))!.requestedRoom).toBeNull();
    });

    it('exige las tres medidas juntas', async () => {
      await expect(service.create(alice, { name: 'x', widthM: '4' }, await photo())).rejects.toThrow();
    });
  });
});

describe('lista de compras con variantes (Fase 3)', () => {
  it('agrupa por producto y variante: el sofá a medida en cuero es otra línea', async () => {
    const repo = new InMemoryProjectRepository();
    const catalog = new InMemoryCatalogRepository([
      catalogItem({
        spec: {
          materialSlots: [{ slot: 'tapizado', label: 'Tapizado', default: 'fabric-linen-sand', allowedKinds: ['fabric', 'leather'] }],
          resize: { x: [1.4, 2.6] },
        },
      }),
    ]);
    const service = new ProjectsService(repo, catalog, new MemoryFileStorage(), new FakeQueue(), new FakeBroker(), new FakeQuota(10), testConfig, new PhotoProcessor(), new MediaUrlSigner(testConfig));
    const created = await service.create({ userId: 'u' }, { name: 'x' }, await photo());
    await repo.update(created.id, {
      roomShell: createRectangularShell(6, 5, 2.6),
      placements: [
        place('a', 'sofa-test', 1.2, 1),
        place('b', 'sofa-test', 3.5, 1),
        place('c', 'sofa-test', 1.5, 3, { dimensionsM: { x: 2.4, y: 0.8, z: 0.9 }, materials: { tapizado: 'leather-cognac' } }),
      ],
    });
    const list = await service.shoppingList({ userId: 'u' }, created.id);
    expect(list.lines).toHaveLength(2);
    const plain = list.lines.find((l) => l.variant === null)!;
    const custom = list.lines.find((l) => l.variant !== null)!;
    expect(plain.quantity).toBe(2);
    expect(custom).toMatchObject({ quantity: 1, variant: '240 × 90 × 80 cm · Tapizado: Cuero coñac' });
    expect(list.total).toBe(1500);
  });
});
