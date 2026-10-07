import { afterEach, describe, expect, it, vi } from 'vitest';
import { newPlacementId } from './ids';

describe('newPlacementId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('genera ids únicos con prefijo y longitud fija', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newPlacementId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^u-[0-9a-f]{16}$/);
  });

  it('funciona aunque crypto.randomUUID no exista (página servida por HTTP fuera de localhost)', () => {
    // Regresión: añadir un mueble lanzaba "crypto.randomUUID is not a function".
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    expect(newPlacementId('x')).toMatch(/^x-[0-9a-f]{16}$/);
  });
});
