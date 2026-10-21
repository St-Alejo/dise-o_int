import { describe, expect, it } from 'vitest';
import { DesignBriefSchema, type DesignBriefInput } from './domain.js';
import { customFinishId } from './finish-spec.js';
import { createRectangularShell } from './geometry.js';
import { assertValidFinishes } from './materials.js';
import { harmonize, hexToHsl, hslToHex, paletteFeatures, seededRandom } from './palette.js';
import { bestProposal, candidateProposals, describeProposal, preferenceScore, priorScore, propose } from './recommend.js';
import { addPrivateBathroom } from './zone-presets.js';

const shell = createRectangularShell(4.5, 4, 2.6);
const brief = (b: DesignBriefInput) => DesignBriefSchema.parse(b);
const TILE = { name: 'Baldosa brillante azul claro y verde', kind: 'tile' as const, colors: ['#a9d4ee', '#9bd3b0'], pattern: 'mosaic' as const, gloss: 0.85, tileSizeM: 0.1 };

describe('paleta', () => {
  it('hex ↔ hsl ida y vuelta', () => {
    for (const hex of ['#a9d4ee', '#9bd3b0', '#2f3e57', '#f4f1ea', '#808080']) expect(hslToHex(hexToHsl(hex))).toBe(hex);
  });

  it('la pared sale clara y apagada; con dos anclas, la segunda es el acento', () => {
    const p = harmonize(['#a9d4ee', '#9bd3b0'], 'analoga', seededRandom(3));
    expect(hexToHsl(p.colors[0]).l).toBeGreaterThan(0.85);
    expect(hexToHsl(p.colors[0]).s).toBeLessThan(0.25);
    expect(p.colors[1]).toBe('#9bd3b0');
    // Misma semilla, misma paleta.
    expect(harmonize(['#a9d4ee'], 'triadica', seededRandom(9))).toEqual(harmonize(['#a9d4ee'], 'triadica', seededRandom(9)));
  });

  it('rasgos: una paleta de grises no tiene saturación y una con blanco y negro tiene contraste', () => {
    const f = paletteFeatures(['#ffffff', '#000000']);
    expect(f.saturation).toBe(0);
    expect(f.contrast).toBeCloseTo(1);
  });
});

describe('Recomendar respeta lo fijado', () => {
  it('el piso fijado (baldosa brillante azul claro con verde) no cambia entre propuestas; el resto sí', () => {
    const b = brief({ surfaces: { floor: { spec: TILE } } });
    const props = [1, 2, 3, 4, 5].map((seed) => propose({ brief: b, finishes: null, styleId: null, shell, seed }));
    const id = customFinishId(TILE);
    for (const p of props) {
      expect(p.finishes.floor).toBe(id);
      expect(p.finishes.custom?.[id]?.colors).toEqual(TILE.colors);
      expect(() => assertValidFinishes(p.finishes)).not.toThrow();
    }
    expect(new Set(props.map((p) => `${p.styleId}|${p.finishes.walls['all']}`)).size).toBeGreaterThan(1);
    // Los colores del piso anclan la paleta: la pared tira a azul.
    const hue = hexToHsl(props[0]!.palette.colors[0]).h;
    expect(hue).toBeGreaterThan(150);
    expect(hue).toBeLessThan(240);
  });

  it('estilo y luz fijados se conservan; sin fijar, no repite los últimos estilos', () => {
    const fixed = propose({ brief: brief({ style: { id: 'industrial' }, lighting: { mood: 'fria', level: 'alta' } }), finishes: null, styleId: 'moderno', shell, seed: 4 });
    expect(fixed.styleId).toBe('industrial');
    expect(fixed.lighting).toEqual({ mood: 'fria', level: 'alta' });
    for (let seed = 0; seed < 20; seed++) {
      const p = propose({ brief: null, finishes: null, styleId: null, shell, seed, recentStyles: ['escandinavo', 'moderno', 'clasico'] });
      expect(['escandinavo', 'moderno', 'clasico']).not.toContain(p.styleId);
    }
  });

  it('la intensidad suave mantiene el estilo actual', () => {
    for (let seed = 0; seed < 6; seed++) {
      expect(propose({ brief: null, finishes: null, styleId: 'bohemio', shell, seed, intensity: 'suave' }).styleId).toBe('bohemio');
    }
  });

  it('un candado suelto (locked: false) es solo una preferencia: no se impone', () => {
    const b = brief({ surfaces: { floor: { material: 'wood-walnut', locked: false } } });
    const floors = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => propose({ brief: b, finishes: null, styleId: null, shell, seed }).finishes.floor));
    expect(floors.size).toBeGreaterThan(1);
  });

  it('el baño privado recibe un tipo de baño que va con el estilo, o el que se pidió', () => {
    const { shell: withBath, zone } = addPrivateBathroom(shell, { floor: 'wood-oak', walls: { all: 'paint-white' }, ceiling: 'paint-white' });
    const p = propose({ brief: brief({ style: { id: 'industrial' } }), finishes: null, styleId: null, shell: withBath, seed: 2 });
    expect(p.finishes.zones?.[zone.id]?.floor).toBe('stone-microcement');
    const asked = propose({ brief: brief({ zones: [{ kind: 'bathroom', preset: 'spa-marmol' }] }), finishes: null, styleId: null, shell: withBath, seed: 2 });
    expect(asked.finishes.zones?.[zone.id]?.floor).toBe('stone-marble-white');
    expect(() => assertValidFinishes(asked.finishes, [zone.id])).not.toThrow();
  });
});

describe('candidatas y nota', () => {
  it('genera candidatas distintas, todas válidas, y elige la de mejor nota', () => {
    const list = candidateProposals({ brief: null, finishes: null, styleId: null, shell, seed: 11 }, 6);
    expect(list).toHaveLength(6);
    for (const p of list) expect(() => assertValidFinishes(p.finishes)).not.toThrow();
    const best = bestProposal(list);
    expect(Math.max(...list.map(priorScore))).toBe(priorScore(best));
    expect(Object.keys(best.features).length).toBeGreaterThan(15);
    expect(describeProposal(best)).toMatch(/piso .*, paredes .*, luz/);
  });
});

describe('preferencias aprendidas', () => {
  it('sin historial es la nota de oficio; con 👍 a un estilo, gana ese estilo', () => {
    const list = candidateProposals({ brief: null, finishes: null, styleId: null, shell, seed: 5 }, 6);
    expect(preferenceScore([])).toBe(priorScore);
    const target = list.find((p) => p.styleId !== bestProposal(list).styleId)!;
    const liked = Array.from({ length: 4 }, () => ({ features: target.features, action: 'like' as const }));
    expect(bestProposal(list, preferenceScore(liked)).styleId).toBe(target.styleId);
    // Un 👎 a lo mismo lo hunde.
    const disliked = liked.map((h) => ({ ...h, action: 'dislike' as const }));
    expect(preferenceScore(disliked)(target)).toBeLessThan(priorScore(target));
  });
});
