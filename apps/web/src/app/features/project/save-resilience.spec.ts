import { createRectangularShell, type FurniturePlacement } from '@interiores/shared-types';
import { describe, expect, it } from 'vitest';
import { DraftStore, agoLabel, draftIsRecoverable, isTransient, retryDelayMs, sceneKey, sceneOf, type SceneDraft } from './save-resilience';

const piece = (id: string, x: number): FurniturePlacement => ({ id, catalogItemId: 'sofa', position: { x, y: 0, z: 1 }, rotationY: 0, lockedByUser: false });
const shell = createRectangularShell(4, 3, 2.6);
const project = (revision: number, placements: FurniturePlacement[]) => ({ revision, furniturePlacements: placements, finishes: null, roomShell: shell });

/** Almacenamiento de mentira; con `broken`, todo lanza (cuota llena, modo privado). */
function fakeStorage(broken = false) {
  const data = new Map<string, string>();
  const fail = () => {
    throw new Error('sin almacenamiento');
  };
  return {
    data,
    getItem: (k: string) => (broken ? fail() : (data.get(k) ?? null)),
    setItem: (k: string, v: string) => (broken ? fail() : void data.set(k, v)),
    removeItem: (k: string) => (broken ? fail() : void data.delete(k)),
  };
}

describe('reintentos del guardado', () => {
  it('solo se reintenta solo lo que puede arreglarse esperando', () => {
    expect([0, 408, 429, 500, 503].every(isTransient)).toBe(true);
    expect([400, 401, 403, 404, 409, 422].some(isTransient)).toBe(false);
  });

  it('la espera se duplica en cada intento, con tope de 30 segundos', () => {
    expect([0, 1, 2, 3, 4, 9].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });
});

describe('huella de la escena', () => {
  it('distingue un mueble movido y reconoce dos escenas iguales', () => {
    const a = sceneOf(project(1, [piece('a', 1)]));
    expect(sceneKey(a)).toBe(sceneKey(sceneOf(project(7, [piece('a', 1)]))));
    expect(sceneKey(a)).not.toBe(sceneKey(sceneOf(project(1, [piece('a', 1.05)]))));
    expect(sceneKey(a)).not.toBe(sceneKey({ ...a, finishes: { floor: 'wood-oak', walls: { all: 'paint-white' }, ceiling: 'paint-white' } }));
  });
});

describe('borrador local', () => {
  const draft: SceneDraft = { revision: 3, savedAt: 1000, placements: [piece('a', 2)], finishes: null, shell };

  it('se guarda por proyecto, se lee y se borra', () => {
    const storage = fakeStorage();
    const drafts = new DraftStore(storage);
    drafts.write('p1', draft);
    expect(drafts.read('p1')).toEqual(draft);
    expect(drafts.read('p2')).toBeNull();
    drafts.clear('p1');
    expect(drafts.read('p1')).toBeNull();
  });

  it('sin almacenamiento, roto o con basura nunca lanza: simplemente no hay borrador', () => {
    for (const drafts of [new DraftStore(null), new DraftStore(fakeStorage(true))]) {
      expect(() => drafts.write('p1', draft)).not.toThrow();
      expect(drafts.read('p1')).toBeNull();
      expect(() => drafts.clear('p1')).not.toThrow();
    }
    const storage = fakeStorage();
    storage.data.set('interiores.borrador.p1', '{no es json');
    expect(new DraftStore(storage).read('p1')).toBeNull();
    storage.data.set('interiores.borrador.p1', '{"algo":1}');
    expect(new DraftStore(storage).read('p1')).toBeNull();
  });

  it('solo se ofrece si es de la revisión actual y trae algo distinto', () => {
    expect(draftIsRecoverable(draft, project(3, [piece('a', 1)]))).toBe(true);
    // El proyecto cambió en el servidor después del borrador: no se mezclan.
    expect(draftIsRecoverable(draft, project(4, [piece('a', 1)]))).toBe(false);
    // Lo mismo que ya está guardado: nada que recuperar.
    expect(draftIsRecoverable(draft, project(3, [piece('a', 2)]))).toBe(false);
    expect(draftIsRecoverable(null, project(3, []))).toBe(false);
  });

  it('dice de cuándo es', () => {
    const now = 10 * 24 * 3_600_000;
    expect(agoLabel(now - 20_000, now)).toBe('hace un momento');
    expect(agoLabel(now - 5 * 60_000, now)).toBe('hace 5 min');
    expect(agoLabel(now - 3 * 3_600_000, now)).toBe('hace 3 h');
    expect(agoLabel(now - 26 * 3_600_000, now)).toBe('ayer');
    expect(agoLabel(now - 4 * 24 * 3_600_000, now)).toBe('hace 4 días');
  });
});
