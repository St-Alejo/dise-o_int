import { renderProjectDossierPdf } from '../src/modules/projects/shopping-list.pdf.js';
import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createRectangularShell, moveWall } from '@interiores/shared-types';
import {
  NotFoundError,
  QuotaExceededError,
  StaleRevisionError,
  UnsupportedMediaError,
  ValidationError,
} from '../src/common/errors.js';
import { PhotoProcessor } from '../src/infrastructure/imaging/photo-processor.js';
import { MediaUrlSigner } from '../src/infrastructure/media/media-url-signer.js';
import { MemoryFileStorage } from '../src/infrastructure/storage/memory-file-storage.js';
import { ProjectsService } from '../src/modules/projects/projects.service.js';
import {
  FakeBroker,
  FakeQueue,
  FakeQuota,
  InMemoryCatalogRepository,
  InMemoryProjectRepository,
  testConfig,
} from './fakes.js';

async function photoWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: '#c8a97e' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'CamaraPrueba' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '4/1 36/1 0/1' } })
    .toBuffer();
}

describe('ProjectsService', () => {
  let repo: InMemoryProjectRepository;
  let storage: MemoryFileStorage;
  let queue: FakeQueue;
  let broker: FakeBroker;
  let quota: FakeQuota;
  let service: ProjectsService;
  let catalog: InMemoryCatalogRepository;
  const alice = { userId: 'alice', requestId: 'req-1' };
  const bob = { userId: 'bob' };

  beforeEach(() => {
    repo = new InMemoryProjectRepository();
    storage = new MemoryFileStorage();
    queue = new FakeQueue();
    broker = new FakeBroker();
    quota = new FakeQuota(10);
    catalog = new InMemoryCatalogRepository();
    service = new ProjectsService(
      repo,
      catalog,
      storage,
      queue,
      broker,
      quota,
      testConfig,
      new PhotoProcessor(),
      new MediaUrlSigner(testConfig),
    );
  });

  async function readyProject() {
    const p = await service.create(alice, { name: 'Sala', roomType: 'living' }, await photoWithGps());
    await repo.update(p.id, { roomShell: createRectangularShell(4, 3.5, 2.6), status: 'ready' }, { bumpRevision: true });
    return (await service.get(alice, p.id));
  }

  describe('create', () => {
    it('normaliza la foto, ELIMINA el EXIF/GPS, consume cuota y encola el análisis', async () => {
      const project = await service.create(alice, { name: 'Sala', roomType: 'living', styles: 'moderno,bohemio' }, await photoWithGps());

      const stored = storage.objects.get(`projects/${project.id}/source.jpg`)!;
      const meta = await sharp(stored.body).metadata();
      expect(meta.exif).toBeUndefined();
      expect(storage.objects.has(`projects/${project.id}/thumb.webp`)).toBe(true);

      expect(quota.used.get('alice')).toBe(2);
      expect(queue.jobs).toEqual([
        expect.objectContaining({ kind: 'analyze-room', jobId: `analyze.${project.id}`, data: expect.objectContaining({ styles: ['moderno', 'bohemio'], requestId: 'req-1' }) }),
      ]);
      expect(broker.events[0]).toMatchObject({ stage: 'queued', projectId: project.id });
      expect(project.status).toBe('processing');
      expect(project.sourcePhotoUrl).toMatch(/^\/api\/media\/projects\//);
    });

    it('rechaza archivos que no son imágenes aunque digan serlo', async () => {
      const fakeJpg = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2000)]);
      await expect(service.create(alice, {}, fakeJpg)).rejects.toBeInstanceOf(UnsupportedMediaError);
      expect(quota.used.get('alice')).toBeUndefined();
    });

    it('rechaza cuando se agota la cuota diaria', async () => {
      quota = new FakeQuota(1);
      service = new ProjectsService(repo, new InMemoryCatalogRepository(), storage, queue, broker, quota, testConfig, new PhotoProcessor(), new MediaUrlSigner(testConfig));
      await expect(service.create(alice, {}, await photoWithGps())).rejects.toBeInstanceOf(QuotaExceededError);
      expect(storage.objects.size).toBe(0);
    });
  });

  describe('create con el cuarto definido a mano', () => {
    const lRoom = { shape: 'L', widthM: 5, depthM: 4, heightM: 2.6, notchWidthM: 2, notchDepthM: 1.5 } as const;

    it('sin foto: el cuarto queda definido, no consume cuota y se encola amueblarlo', async () => {
      const project = await service.create(alice, { name: 'Estudio', roomType: 'office', styles: 'bohemio', roomSpec: JSON.stringify(lRoom) }, undefined);

      expect(project.roomShell).toMatchObject({ shape: 'L', widthM: 5, depthM: 4, needsCalibration: false, scaleConfidence: 1 });
      expect(project.roomShell!.walls.map((w) => w.id)).toEqual(['w-back', 'w-right', 'w-3', 'w-4', 'w-front', 'w-left']);
      // Sin aberturas indicadas nace con una ventana al fondo y una puerta al frente.
      expect(project.roomShell!.openings.map((o) => [o.type, o.wallId])).toEqual([['window', 'w-back'], ['door', 'w-front']]);
      expect(project.sourcePhotoUrl).toBeNull();
      expect(storage.objects.size).toBe(0);
      expect(quota.used.get('alice')).toBeUndefined();
      expect(queue.jobs).toEqual([
        expect.objectContaining({ kind: 'build-scene', jobId: `scene.${project.id}`, data: expect.objectContaining({ styleId: 'bohemio', keepLocked: false, finalize: true }) }),
      ]);
      expect(broker.events[0]).toMatchObject({ stage: 'queued', kind: 'build-scene' });
    });

    it('con foto: el cuarto a mano manda y la foto sigue al análisis para las propuestas', async () => {
      const project = await service.create(alice, { roomSpec: { shape: 'U', widthM: 6, depthM: 5, heightM: 2.8 } }, await photoWithGps());
      expect(project.roomShell!.walls).toHaveLength(8);
      expect(project.sourcePhotoUrl).not.toBeNull();
      expect(queue.jobs[0]).toMatchObject({ kind: 'analyze-room' });
    });

    it('respeta las aberturas indicadas y rechaza las que no caben o apuntan a otra pared', async () => {
      const door = { id: 'o-door-1', type: 'door', wallId: 'w-3', widthM: 0.9, heightM: 2.05, offsetM: 1, sillHeightM: 0 } as const;
      const project = await service.create(alice, { roomSpec: { ...lRoom, openings: [door] } }, undefined);
      expect(project.roomShell!.openings).toEqual([door]);

      await expect(service.create(alice, { roomSpec: { ...lRoom, openings: [{ ...door, offsetM: 1.9 }] } }, undefined)).rejects.toThrow(/no cabe/);
      await expect(service.create(alice, { roomSpec: { ...lRoom, openings: [{ ...door, wallId: 'w-9' }] } }, undefined)).rejects.toBeInstanceOf(ValidationError);
      expect(repo.projects.size).toBe(1);
    });

    it('sin foto ni cuarto a mano no hay con qué empezar', async () => {
      await expect(service.create(alice, { name: 'Nada' }, undefined)).rejects.toBeInstanceOf(ValidationError);
      await expect(service.create(alice, { roomSpec: '{no es json' }, undefined)).rejects.toThrow();
    });

    it('reintentar un proyecto sin foto vuelve a encolar el amueblado', async () => {
      const p = await service.create(alice, { styles: 'moderno', roomSpec: lRoom }, undefined);
      await repo.update(p.id, { status: 'failed', lastError: 'IA caída' });
      queue.jobs = [];
      await service.retryAnalysis(alice, p.id);
      expect(queue.jobs[0]).toMatchObject({ kind: 'build-scene', data: { finalize: true, styleId: 'moderno' } });
    });
  });

  describe('retryAnalysis', () => {
    it('solo reintenta proyectos fallidos y vuelve a encolar el análisis', async () => {
      const p = await service.create(alice, { styles: 'moderno' }, await photoWithGps());
      await expect(service.retryAnalysis(alice, p.id)).rejects.toBeInstanceOf(ValidationError);
      await repo.update(p.id, { status: 'failed', lastError: 'IA caída' });
      queue.jobs = [];
      const retried = await service.retryAnalysis(alice, p.id);
      expect(retried.status).toBe('processing');
      expect(retried.lastError).toBeNull();
      expect(queue.jobs[0]).toMatchObject({ kind: 'analyze-room', data: { styles: ['moderno'] } });
    });
  });

  describe('propiedad', () => {
    it('un usuario no puede ver ni borrar proyectos ajenos (404, no 403)', async () => {
      const p = await service.create(alice, {}, await photoWithGps());
      await expect(service.get(bob, p.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.remove(bob, p.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('autoLayout', () => {
    it('cada distribución es un job propio de la revisión: un doble clic no encola dos, pero la siguiente sí', async () => {
      const p = await readyProject();
      const before = queue.jobs.length;
      const first = await service.autoLayout(alice, p.id, { keepLocked: true, seed: 1 });
      const again = await service.autoLayout(alice, p.id, { keepLocked: true, seed: 2 });
      expect(again.jobId).toBe(first.jobId);
      expect(queue.jobs).toHaveLength(before + 1);
      // La escena cambió (el job anterior escribió su resultado): la siguiente petición es otro job.
      const saved = await service.updateScene(alice, p.id, { revision: p.revision, furniturePlacements: [] });
      const next = await service.autoLayout(alice, p.id, { keepLocked: true, seed: 3 });
      expect(next.jobId).not.toBe(first.jobId);
      expect(next.jobId).toBe(`scene.${p.id}.r${saved.revision}`);
      expect(queue.jobs).toHaveLength(before + 2);
    });
  });

  describe('importScene (guardar la demo sin cuenta)', () => {
    const shell = createRectangularShell(4, 3.5, 2.6);
    const sofa = { id: 'p1', catalogItemId: 'sofa-test', position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: false };
    const body = { name: 'Sala escandinava', roomType: 'living' as const, roomShell: shell, furniturePlacements: [sofa], selectedStyleId: 'escandinavo' as const };

    it('crea un proyecto propio, listo y guardado, con su planta, muebles y estilo', async () => {
      const created = await service.importScene(alice, body);
      expect(created).toMatchObject({ name: 'Sala escandinava', status: 'ready', saved: true, selectedStyleId: 'escandinavo', sourcePhotoUrl: null, revision: 0 });
      expect(created.furniturePlacements).toHaveLength(1);
      expect(created.roomShell).toMatchObject({ widthM: 4, depthM: 3.5, heightM: 2.6 });
      // El id del cuarto es nuevo: dos importaciones de la misma plantilla no lo comparten.
      expect(created.roomShell!.id).not.toBe(shell.id);
      expect((await service.list(alice)).map((p) => p.id)).toContain(created.id);
      await expect(service.get(bob, created.id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('no se fía de lo que llega: muebles inexistentes, plantas imposibles y acabados inventados se rechazan', async () => {
      await expect(service.importScene(alice, { ...body, furniturePlacements: [{ ...sofa, catalogItemId: 'no-existe' }] })).rejects.toBeInstanceOf(ValidationError);
      await expect(service.importScene(alice, { ...body, roomShell: { ...shell, widthM: 200 } })).rejects.toBeInstanceOf(ValidationError);
      await expect(
        service.importScene(alice, { ...body, finishes: { floor: 'paint-white', walls: { all: 'paint-white' }, ceiling: 'paint-white' } }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(await service.list(alice)).toHaveLength(0);
    });

    it('un mueble que llega fuera del cuarto se mete dentro', async () => {
      const created = await service.importScene(alice, { ...body, furniturePlacements: [{ ...sofa, position: { x: 40, y: 0, z: 40 } }] });
      const { x, z } = created.furniturePlacements[0]!.position;
      expect(x).toBeLessThan(4);
      expect(z).toBeLessThan(3.5);
    });
  });

  describe('dossier (el proyecto en PDF)', () => {
    it('reúne la ficha, la planta con los muebles de piso y la lista de compras, y el PDF sale con dos páginas', async () => {
      const p = await readyProject();
      await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [
          { id: 'p1', catalogItemId: 'sofa-test', position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: false },
          { id: 'p2', catalogItemId: 'lamp', position: { x: 2, y: 1.7, z: 1.75 }, rotationY: 0, lockedByUser: false },
        ],
      });
      const dossier = await service.dossier(alice, p.id);
      expect(dossier).toMatchObject({ name: 'Sala', subtitle: 'Sala', areaM2: 14, pieceCount: 2 });
      // La lámpara de techo no se dibuja en planta; el sofá sí, con sus cuatro esquinas.
      expect(dossier.pieces).toHaveLength(1);
      expect(dossier.pieces[0]!.corners).toHaveLength(4);
      expect(dossier.list.lines.length).toBeGreaterThan(0);

      const pdf = await renderProjectDossierPdf(dossier);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.toString('latin1').match(/\/Type \/Page[^s]/g)).toHaveLength(2);
      await expect(service.dossier(bob, p.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('presupuesto', () => {
    it('el tope se guarda con el cuarto, no cambia su revisión y solo lo toca su dueño', async () => {
      const p = await readyProject();
      expect(p.budgetCap).toBeNull();
      const capped = await service.setBudget(alice, p.id, 1500);
      expect(capped.budgetCap).toBe(1500);
      expect(capped.revision).toBe(p.revision);
      expect((await service.list(alice))[0]!.budgetCap).toBe(1500);
      await expect(service.setBudget(bob, p.id, 10)).rejects.toBeInstanceOf(NotFoundError);
      // La copia hereda el tope; quitarlo lo deja sin él.
      expect((await service.duplicate(alice, p.id)).budgetCap).toBe(1500);
      expect((await service.setBudget(alice, p.id, null)).budgetCap).toBeNull();
    });
  });

  describe('viviendas (varios cuartos juntos)', () => {
    const room = { shape: 'rect' as const, widthM: 4, depthM: 3, heightM: 2.6 };

    it('un cuarto funda una vivienda y los siguientes se crean dentro de ella', async () => {
      const sala = await readyProject();
      expect(sala.home).toBeNull();
      const withHome = await service.setHome(alice, sala.id, { homeName: 'Apartamento' });
      expect(withHome.home).toMatchObject({ name: 'Apartamento', rooms: [{ id: sala.id, name: 'Sala', roomType: 'living' }] });

      const cocina = await service.create(alice, { name: 'Cocina', roomType: 'kitchen', roomSpec: room, homeId: withHome.home!.id }, undefined);
      expect(cocina.home!.rooms.map((r) => r.name)).toEqual(['Sala', 'Cocina']);
      // Desde cualquiera de sus cuartos se ve la vivienda entera, y la lista los marca.
      expect((await service.get(alice, sala.id)).home!.rooms).toHaveLength(2);
      expect((await service.list(alice)).map((p) => p.homeName)).toEqual(['Apartamento', 'Apartamento']);
    });

    it('renombrar la vivienda desde un cuarto la renombra en todos', async () => {
      const sala = await service.setHome(alice, (await readyProject()).id, { homeName: 'Piso' });
      const otro = await service.create(alice, { name: 'Estudio', roomType: 'office', roomSpec: room, homeId: sala.home!.id }, undefined);
      await service.setHome(alice, otro.id, { homeName: 'Casa de la playa' });
      expect((await service.get(alice, sala.id)).home!.name).toBe('Casa de la playa');
    });

    it('un cuarto suelto entra en una vivienda existente y puede salir de ella', async () => {
      const sala = await service.setHome(alice, (await readyProject()).id, { homeName: 'Piso' });
      const suelto = await service.create(alice, { name: 'Baño', roomType: 'bathroom', roomSpec: room }, undefined);
      const dentro = await service.setHome(alice, suelto.id, { homeId: sala.home!.id });
      expect(dentro.home).toMatchObject({ id: sala.home!.id, name: 'Piso' });
      expect(dentro.home!.rooms).toHaveLength(2);
      const fuera = await service.setHome(alice, suelto.id, { homeId: null });
      expect(fuera.home).toBeNull();
      expect((await service.get(alice, sala.id)).home!.rooms).toHaveLength(1);
    });

    it('cada cuarto guarda su sitio en la planta conjunta; fuera de una vivienda no lo tiene', async () => {
      const sala = await readyProject();
      await expect(service.setHomePosition(alice, sala.id, { x: 1, z: 2 })).rejects.toBeInstanceOf(ValidationError);
      const home = (await service.setHome(alice, sala.id, { homeName: 'Piso' })).home!;
      await service.setHomePosition(alice, sala.id, { x: 5.2, z: -1 });
      expect((await service.list(alice))[0]).toMatchObject({ homeId: home.id, homePosition: { x: 5.2, z: -1 } });
      await expect(service.setHomePosition(bob, sala.id, { x: 0, z: 0 })).rejects.toBeInstanceOf(NotFoundError);
      // Al salir de la vivienda, el sitio se olvida.
      await service.setHome(alice, sala.id, { homeId: null });
      expect((await service.list(alice))[0]!.homePosition).toBeUndefined();
    });

    it('nadie entra en la vivienda de otra persona, ni creando ni moviendo un cuarto', async () => {
      const sala = await service.setHome(alice, (await readyProject()).id, { homeName: 'Piso' });
      const ajeno = await service.create(bob, { name: 'Cuarto de Bob', roomType: 'bedroom', roomSpec: room }, undefined);
      await expect(service.setHome(bob, ajeno.id, { homeId: sala.home!.id })).rejects.toBeInstanceOf(ValidationError);
      await expect(service.create(bob, { name: 'Otro', roomType: 'bedroom', roomSpec: room, homeId: sala.home!.id }, undefined)).rejects.toBeInstanceOf(ValidationError);
      await expect(service.setHome(bob, sala.id, { homeName: 'Mío' })).rejects.toBeInstanceOf(NotFoundError);
      expect((await service.list(bob)).every((p) => !p.homeId)).toBe(true);
    });

    it('duplicar un cuarto lo deja en la misma vivienda', async () => {
      const sala = await service.setHome(alice, (await readyProject()).id, { homeName: 'Piso' });
      const copia = await service.duplicate(alice, sala.id);
      expect(copia.home!.rooms).toHaveLength(2);
    });
  });

  describe('version (comparar sin restaurar)', () => {
    it('devuelve la versión entera y no cambia el proyecto', async () => {
      const p = await readyProject();
      const withSofa = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [{ id: 'p1', catalogItemId: 'sofa-test', position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: false }],
      });
      const saved = await service.saveVersion(alice, p.id, 'con sofá');
      await service.updateScene(alice, p.id, { revision: saved.revision, furniturePlacements: [] });
      const version = await service.version(alice, p.id, saved.versions[0]!.id);
      expect(version).toMatchObject({ number: 1, note: 'con sofá', itemCount: 1 });
      expect(version.furniturePlacements).toEqual(withSofa.furniturePlacements);
      expect(version.roomShell).toEqual(withSofa.roomShell);
      // Mirarla no la restaura.
      expect((await service.get(alice, p.id)).furniturePlacements).toHaveLength(0);
      await expect(service.version(bob, p.id, saved.versions[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.version(alice, p.id, '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('duplicate', () => {
    it('copia el cuarto, los muebles y los acabados en un proyecto nuevo y listo', async () => {
      const p = await readyProject();
      const withSofa = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [{ id: 'p1', catalogItemId: 'sofa-test', position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: true }],
        finishes: { floor: 'wood-walnut', walls: { all: 'paint-sage' }, ceiling: 'paint-white' },
      });
      const copy = await service.duplicate(alice, p.id);
      expect(copy.id).not.toBe(p.id);
      expect(copy).toMatchObject({ name: `${p.name} (copia)`, status: 'ready', saved: false, sourcePhotoUrl: null, revision: 0 });
      expect(copy.furniturePlacements).toEqual(withSofa.furniturePlacements);
      expect(copy.finishes).toEqual(withSofa.finishes);
      expect(copy.roomShell).toEqual(withSofa.roomShell);
      expect(copy.versions).toEqual([]);
      // Son independientes: editar la copia no toca el original.
      await service.updateScene(alice, copy.id, { revision: copy.revision, furniturePlacements: [] });
      expect((await service.get(alice, p.id)).furniturePlacements).toHaveLength(1);
    });

    it('solo el dueño puede duplicar, y el nombre no pasa de 120 caracteres', async () => {
      const p = await readyProject();
      await expect(service.duplicate(bob, p.id)).rejects.toBeInstanceOf(NotFoundError);
      const long = await service.rename(alice, p.id, 'x'.repeat(120));
      const copy = await service.duplicate(alice, long.id);
      expect(copy.name).toHaveLength(120);
      expect(copy.name.endsWith(' (copia)')).toBe(true);
    });
  });

  describe('updateScene', () => {
    it('aplica control de concurrencia optimista', async () => {
      const p = await readyProject();
      const placement = { id: 'p1', catalogItemId: 'sofa-test', position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: true };
      const saved = await service.updateScene(alice, p.id, { revision: p.revision, furniturePlacements: [placement] });
      expect(saved.revision).toBe(p.revision + 1);
      await expect(
        service.updateScene(alice, p.id, { revision: p.revision, furniturePlacements: [] }),
      ).rejects.toBeInstanceOf(StaleRevisionError);
    });

    it('mete dentro del cuarto los muebles fuera de límites y fija la altura de los colgantes', async () => {
      const p = await readyProject();
      const saved = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [
          { id: 'p1', catalogItemId: 'sofa-test', position: { x: -5, y: 3, z: 99 }, rotationY: -Math.PI / 2, lockedByUser: true },
          { id: 'p2', catalogItemId: 'lamp', position: { x: 2, y: 0, z: 2 }, rotationY: 0, lockedByUser: true },
        ],
      });
      const [sofa, lamp] = saved.furniturePlacements;
      expect(sofa!.position.x).toBeGreaterThanOrEqual(0.45 - 1e-9);
      expect(sofa!.position.z).toBeLessThanOrEqual(3.5 - 1 + 1e-9);
      expect(sofa!.position.y).toBe(0);
      expect(sofa!.rotationY).toBeCloseTo((3 * Math.PI) / 2);
      expect(lamp!.position.y).toBeCloseTo(2.6 - 0.9);
    });

    it('guarda la planta editada en el plano y reacomoda los muebles en ella', async () => {
      const p = await readyProject();
      const before = p.roomShell!;
      const edited = moveWall(before, 'w-right', -1).shell;
      const saved = await service.updateScene(alice, p.id, {
        revision: p.revision,
        // Del cliente solo se toma la geometría: el id y la confianza de la escala no cambian por aquí.
        roomShell: { ...edited, id: 'otro', heightM: 3, scaleConfidence: 1, needsCalibration: false },
        furniturePlacements: [{ id: 'p1', catalogItemId: 'sofa-test', position: { x: before.widthM - 0.5, y: 0, z: 1 }, rotationY: 0, lockedByUser: true }],
      });
      expect(saved.roomShell).toMatchObject({ id: before.id, widthM: before.widthM - 1, heightM: 3, needsCalibration: before.needsCalibration });
      // Un alto fuera de los límites se rechaza.
      await expect(
        service.updateScene(alice, p.id, { revision: saved.revision, roomShell: { ...edited, heightM: 9 }, furniturePlacements: [] }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(saved.furniturePlacements[0]!.position.x).toBeLessThan(before.widthM - 1);
    });

    it('rechaza una planta imposible sin tocar el proyecto', async () => {
      const p = await readyProject();
      const shell = p.roomShell!;
      const crossed = { ...shell, walls: shell.walls.map((w, i) => (i === 1 ? { ...w, end: { x: 1, y: 0, z: -2 } } : i === 2 ? { ...w, start: { x: 1, y: 0, z: -2 } } : w)) };
      await expect(service.updateScene(alice, p.id, { revision: p.revision, roomShell: crossed, furniturePlacements: [] })).rejects.toBeInstanceOf(ValidationError);
      expect((await service.get(alice, p.id)).revision).toBe(p.revision);
    });

    it('rechaza muebles que no existen en el catálogo e ids repetidos', async () => {
      const p = await readyProject();
      const base = { position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: false };
      await expect(
        service.updateScene(alice, p.id, { revision: p.revision, furniturePlacements: [{ id: 'x', catalogItemId: 'no-existe', ...base }] }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        service.updateScene(alice, p.id, {
          revision: p.revision,
          furniturePlacements: [
            { id: 'x', catalogItemId: 'sofa-test', ...base },
            { id: 'x', catalogItemId: 'sofa-test', ...base },
          ],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('calibrate', () => {
    it('reescala cuarto y posiciones y marca la escala como confiable', async () => {
      const p = await readyProject();
      const withSofa = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [{ id: 'p1', catalogItemId: 'sofa-test', position: { x: 2, y: 0, z: 1.5 }, rotationY: 0, lockedByUser: false }],
      });
      const out = await service.calibrate(alice, p.id, { revision: withSofa.revision, reference: 'room-width', valueM: 5 });
      expect(out.roomShell!.widthM).toBeCloseTo(5);
      expect(out.roomShell!.needsCalibration).toBe(false);
      expect(out.furniturePlacements[0]!.position.x).toBeCloseTo(2.5);
    });

    it('traduce factores absurdos a 422', async () => {
      const p = await readyProject();
      await expect(service.calibrate(alice, p.id, { revision: p.revision, reference: 'room-width', valueM: 25 })).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('generateStyles', () => {
    it('reutiliza renders en caché sin consumir cuota ni encolar', async () => {
      const p = await readyProject();
      const used = quota.used.get('alice')!;
      const first = await service.generateStyles(alice, p.id, { styles: ['clasico'], promptStrength: 0.7 });
      expect(first.jobId).toMatch(/^styles./);
      expect(quota.used.get('alice')).toBe(used + 1);

      // El worker completó la generación
      const preview = repo.previews.find((x) => x.styleId === 'clasico')!;
      await repo.updatePreview(preview.id, { status: 'ready', imageKey: 'projects/x/previews/a.jpg', provider: 'mock' });

      const second = await service.generateStyles(alice, p.id, { styles: ['clasico'], promptStrength: 0.7 });
      expect(second.jobId).toBe('cached');
      expect(quota.used.get('alice')).toBe(used + 1);
      expect(repo.previews.filter((x) => x.styleId === 'clasico')).toHaveLength(2);
    });
  });

  describe('versiones, compartir y borrado', () => {
    it('guardar una versión marca el proyecto como guardado y se puede restaurar', async () => {
      const p = await readyProject();
      const v1 = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [{ id: 'p1', catalogItemId: 'sofa-test', position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: false }],
      });
      const withVersion = await service.saveVersion(alice, p.id, 'primera');
      expect(withVersion.saved).toBe(true);
      expect(withVersion.versions[0]).toMatchObject({ number: 1, note: 'primera', itemCount: 1 });

      await service.updateScene(alice, p.id, { revision: v1.revision, furniturePlacements: [] });
      const restored = await service.restoreVersion(alice, p.id, withVersion.versions[0]!.id);
      expect(restored.furniturePlacements).toHaveLength(1);
    });

    it('compartir genera un token nuevo y revoca los anteriores', async () => {
      const p = await readyProject();
      const a = await service.share(alice, p.id);
      const b = await service.share(alice, p.id);
      expect(a.token).not.toBe(b.token);
      expect(await repo.findProjectIdByShareToken(a.token)).toBeNull();
      expect(await repo.findProjectIdByShareToken(b.token)).toBe(p.id);
      expect((await service.get(alice, p.id)).visibility).toBe('shared-link');
    });

    it('borrar elimina de verdad los archivos en S3 y el registro', async () => {
      const p = await readyProject();
      await service.remove(alice, p.id);
      expect([...storage.objects.keys()].some((k) => k.includes(p.id))).toBe(false);
      expect(await repo.findById(p.id)).toBeNull();
    });

    it('la lista de proyectos resume área, estilo y total estimado con una sola consulta al catálogo', async () => {
      const p = await readyProject();
      await readyProject();
      const base = { rotationY: 0, lockedByUser: false };
      await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [
          { id: 'a', catalogItemId: 'sofa-test', position: { x: 1.1, y: 0, z: 0.5 }, ...base },
          { id: 'b', catalogItemId: 'sofa-test', position: { x: 2.9, y: 0, z: 3 }, ...base },
          { id: 'c', catalogItemId: 'lamp', position: { x: 2, y: 0, z: 2 }, ...base },
        ],
      });
      const findByIds = vi.spyOn(catalog, 'findByIds');
      const item = (await service.list(alice)).find((x) => x.id === p.id)!;
      expect(findByIds).toHaveBeenCalledTimes(1);
      expect(item).toMatchObject({ itemCount: 3, estimatedTotal: 1100, currency: 'USD' });
      expect(item.areaM2).toBe(14);
      expect(item.outline).toHaveLength(4);
    });

    it('un proyecto sin muebles omite el total estimado', async () => {
      const p = await readyProject();
      await service.updateScene(alice, p.id, { revision: p.revision, furniturePlacements: [] });
      const item = (await service.list(alice)).find((x) => x.id === p.id)!;
      expect(item.estimatedTotal).toBeUndefined();
      expect(item.currency).toBeUndefined();
    });

    it('la lista de compras agrupa por mueble y suma precios', async () => {
      const p = await readyProject();
      const base = { rotationY: 0, lockedByUser: false };
      await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [
          { id: 'a', catalogItemId: 'sofa-test', position: { x: 1.1, y: 0, z: 0.5 }, ...base },
          { id: 'b', catalogItemId: 'sofa-test', position: { x: 2.9, y: 0, z: 3 }, ...base },
          { id: 'c', catalogItemId: 'lamp', position: { x: 2, y: 0, z: 2 }, ...base },
        ],
      });
      const list = await service.shoppingList(alice, p.id);
      expect(list.lines.find((l) => l.catalogItemId === 'sofa-test')).toMatchObject({ quantity: 2, subtotal: 1000 });
      expect(list.total).toBe(1100);
    });
  });
});
