import { describe, expect, it } from 'vitest';
import { ganttBars } from './takeoff-panel.component';

describe('ganttBars', () => {
  it('cada fase empieza donde acaba la anterior, en % del total', () => {
    const bars = ganttBars({
      days: 4,
      schedule: [
        { phase: 'plaster', label: 'Estuco', startDay: 0, days: 2, codes: ['skim-coat'] },
        { phase: 'paint', label: 'Pintura', startDay: 2, days: 2, codes: ['paint'] },
      ],
    });
    expect(bars).toEqual([
      { label: 'Estuco', left: 0, width: 50, days: 2 },
      { label: 'Pintura', left: 50, width: 50, days: 2 },
    ]);
    expect(ganttBars({ days: 0, schedule: [] })).toEqual([]);
  });
});
