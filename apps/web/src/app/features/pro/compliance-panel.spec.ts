import { describe, expect, it } from 'vitest';
import { heatmapCells } from './compliance-panel.component';

describe('heatmapCells', () => {
  it('cada celda se centra en su punto y se pinta según la luz respecto al objetivo', () => {
    const grid = { stepM: 0.5, workPlaneM: 0.75, cells: [{ x: 1.25, z: 0.75, lux: 0 }, { x: 1.75, z: 0.75, lux: 300.4 }], avgLux: 150, minLux: 0, maxLux: 300, uniformity: 0 };
    const cells = heatmapCells(grid, 300);
    expect(cells[0]).toEqual({ x: 1, y: 0.5, size: 0.5, fill: '#0d1b4c', lux: 0 });
    expect(cells[1]).toMatchObject({ x: 1.5, lux: 300 });
    expect(cells[1]!.fill).toMatch(/^#f2c9/);
  });
});
