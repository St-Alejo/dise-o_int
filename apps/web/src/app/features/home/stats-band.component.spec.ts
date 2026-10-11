import { TestBed } from '@angular/core/testing';
import type { CatalogItem } from '@interiores/shared-types';
import { CatalogApi } from '../../core/api/projects.api';
import { StatsBandComponent, statsOf } from './stats-band.component';

const item = (category: string) => ({ category }) as CatalogItem;

describe('statsOf', () => {
  it('con catálogo cuenta piezas y categorías distintas', () => {
    const stats = statsOf([item('sofa'), item('sofa'), item('lighting')]);
    expect(stats.slice(0, 2).map((s) => s.value)).toEqual([3, 2]);
    expect(stats).toHaveLength(5);
  });

  it('sin catálogo (o vacío) deja solo las cifras que no dependen de la red', () => {
    expect(statsOf(null)).toHaveLength(3);
    expect(statsOf([])).toEqual(statsOf(null));
    expect(statsOf(null).map((s) => s.value)).toEqual([6, 4, 6]);
  });
});

describe('StatsBandComponent', () => {
  async function render(all: () => Promise<CatalogItem[]>): Promise<string[]> {
    TestBed.configureTestingModule({ providers: [{ provide: CatalogApi, useValue: { all } }] });
    const fixture = TestBed.createComponent(StatsBandComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('dd')].map((dd) => dd.textContent!.trim());
  }

  it('muestra las cifras del catálogo cuando responde', async () => {
    expect(await render(() => Promise.resolve([item('sofa'), item('bed')]))).toEqual(['2', '2', '6', '4', '6']);
  });

  it('si el catálogo falla, la franja sigue entera con las demás', async () => {
    expect(await render(() => Promise.reject(new Error('sin red')))).toEqual(['6', '4', '6']);
  });
});
