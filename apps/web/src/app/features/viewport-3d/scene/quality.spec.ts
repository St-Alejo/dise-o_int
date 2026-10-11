import { describe, expect, it } from 'vitest';
import { QUALITY, QualityGovernor, SAMPLE_FRAMES, SLOW_FRAME_MS, startingLevel } from './quality';

const feed = (governor: QualityGovernor, ms: number, frames = SAMPLE_FRAMES) => {
  let changed: string | null = null;
  for (let i = 0; i < frames; i++) changed = governor.sample(ms) ?? changed;
  return changed;
};

describe('QualityGovernor', () => {
  it('con cuadros rápidos se queda donde está', () => {
    const governor = new QualityGovernor('high', true);
    expect(feed(governor, 16, SAMPLE_FRAMES * 3)).toBeNull();
    expect(governor.level).toBe('high');
  });

  it('con cuadros lentos baja un escalón cada vez, hasta el más bajo', () => {
    const governor = new QualityGovernor('high', true);
    expect(feed(governor, SLOW_FRAME_MS * 2)).toBe('medium');
    expect(feed(governor, SLOW_FRAME_MS * 2)).toBe('low');
    expect(feed(governor, SLOW_FRAME_MS * 2)).toBeNull();
    expect(governor.level).toBe('low');
  });

  it('un cuadro lento suelto no cuenta', () => {
    const governor = new QualityGovernor('high', true);
    governor.sample(400);
    expect(feed(governor, 10, SAMPLE_FRAMES - 1)).toBeNull();
    expect(governor.level).toBe('high');
  });

  it('lo medido antes de una pausa se olvida', () => {
    const governor = new QualityGovernor('high', true);
    feed(governor, 200, SAMPLE_FRAMES - 1);
    governor.reset();
    expect(governor.sample(200)).toBeNull();
  });

  it('con un nivel elegido a mano no cambia', () => {
    const governor = new QualityGovernor('high', false);
    expect(feed(governor, 500, SAMPLE_FRAMES * 2)).toBeNull();
    expect(governor.level).toBe('high');
  });

  it('en automático se empieza por arriba, salvo sin GPU; a mano, donde se eligió', () => {
    expect(startingLevel('auto', 'ANGLE (NVIDIA GeForce RTX 3060)')).toBe('high');
    expect(startingLevel('auto', null)).toBe('high');
    expect(startingLevel('auto', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')).toBe('low');
    expect(startingLevel('auto', 'llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('low');
    expect(startingLevel('high', 'SwiftShader')).toBe('high');
    expect(startingLevel('medium', null)).toBe('medium');
  });

  it('cada escalón pide menos que el anterior', () => {
    expect(QUALITY.medium.maxPixelRatio).toBeLessThan(QUALITY.high.maxPixelRatio);
    expect(QUALITY.low.maxPixelRatio).toBeLessThanOrEqual(QUALITY.medium.maxPixelRatio);
    expect(QUALITY.high.ao && !QUALITY.medium.ao && !QUALITY.low.postFx).toBe(true);
  });
});
