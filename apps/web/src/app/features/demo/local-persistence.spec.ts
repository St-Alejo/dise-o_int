import { TestBed } from '@angular/core/testing';
import { createRectangularShell, type FurnishedScene } from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { CatalogApi } from '../../core/api/projects.api';
import { DEMO_PREFIX, LocalPersistence, demoProject } from './local-persistence';

const TEMPLATE = 'sala-escandinava';
const ID = `${DEMO_PREFIX}${TEMPLATE}`;
const scene: FurnishedScene = {
  id: TEMPLATE,
  name: 'Sala escandinava',
  roomType: 'living',
  styleId: 'escandinavo',
  roomShell: createRectangularShell(5, 4, 2.6),
  furniturePlacements: [{ id: 'sofa-1', catalogItemId: 'sofa', position: { x: 4.2, y: 0, z: 3.4 }, rotationY: 0, lockedByUser: false }],
  finishes: null,
};
const sofa = { id: 'sofa', dimensionsM: { x: 1.6, y: 0.8, z: 0.9 } };

describe('LocalPersistence', () => {
  let fetched: string[];
  const create = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [LocalPersistence, { provide: CatalogApi, useValue: { all: async () => [sofa] } }] });
    return TestBed.inject(LocalPersistence);
  };

  beforeEach(() => {
    localStorage.clear();
    fetched = [];
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return { ok: true, status: 200, json: async () => scene };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('la primera vez abre la plantilla como un proyecto listo, en la revisión 0', async () => {
    const project = await create().get(ID);
    expect(fetched).toEqual([`/escenas/${TEMPLATE}.json`]);
    expect(project).toMatchObject({ id: ID, status: 'ready', revision: 0, selectedStyleId: 'escandinavo', saved: false });
    expect(project.furniturePlacements).toHaveLength(1);
  });

  it('guardar sube la revisión y lo guardado sobrevive a recargar la página', async () => {
    const first = create();
    const base = await first.get(ID);
    const moved = [{ ...base.furniturePlacements[0]!, position: { x: 1, y: 0, z: 1 } }];
    const saved = await first.saveScene(ID, { revision: base.revision, furniturePlacements: moved, finishes: null });
    expect(saved.revision).toBe(1);

    fetched = [];
    const again = await create().get(ID);
    expect(fetched).toEqual([]); // sale de este navegador, no de la plantilla
    expect(again.furniturePlacements[0]!.position.x).toBe(1);
    expect(again.revision).toBe(1);
  });

  it('empezar de nuevo olvida lo guardado', async () => {
    const local = create();
    const base = await local.get(ID);
    await local.saveScene(ID, { revision: 0, furniturePlacements: [], finishes: base.finishes });
    local.reset(ID);
    expect((await local.get(ID)).furniturePlacements).toHaveLength(1);
  });

  it('cambiar las medidas del cuarto mete dentro los muebles que quedarían fuera', async () => {
    const local = create();
    await local.get(ID);
    const resized = await local.updateRoom(ID, { revision: 0, widthM: 3, depthM: 3, heightM: 2.6 });
    expect(resized.roomShell).toMatchObject({ widthM: 3, depthM: 3 });
    const { x, z } = resized.furniturePlacements[0]!.position;
    expect(x + sofa.dimensionsM.x / 2).toBeLessThanOrEqual(3.01);
    expect(z + sofa.dimensionsM.z / 2).toBeLessThanOrEqual(3.01);
  });

  it('una plantilla que no existe se dice con claridad, sin pedir nada al servidor', async () => {
    await expect(create().get(`${DEMO_PREFIX}no-existe`)).rejects.toMatchObject({ status: 404 });
    await expect(create().get(`${DEMO_PREFIX}no-existe`)).rejects.toBeInstanceOf(ApiError);
    expect(fetched).toEqual([]);
  });

  it('lo guardado con otra forma (una versión vieja) se descarta y se vuelve a la plantilla', async () => {
    localStorage.setItem(`interiores.demo.${ID}`, JSON.stringify({ id: ID, cosa: 'rara' }));
    expect((await create().get(ID)).revision).toBe(0);
  });

  it('demoProject conserva la escena de la plantilla', () => {
    expect(demoProject(scene, '2026-01-01T00:00:00.000Z')).toMatchObject({ name: scene.name, roomShell: scene.roomShell, createdAt: '2026-01-01T00:00:00.000Z' });
  });

  it('el tope de gasto se guarda con la demo y no cambia la revisión de la escena', async () => {
    const local = create();
    const before = await local.get(ID);
    const capped = await local.setBudget(ID, 900);
    expect(capped.budgetCap).toBe(900);
    expect(capped.revision).toBe(before.revision);
    expect((await create().get(ID)).budgetCap).toBe(900);
    expect((await local.setBudget(ID, null)).budgetCap).toBeNull();
  });
});
