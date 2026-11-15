import { TestBed } from '@angular/core/testing';
import { STYLE_IDS } from '@interiores/shared-types';
import { CatalogApi } from '../../core/api/projects.api';
import { cycleFrame, stepAt } from './motion';
import { PiecesComponent, PIECES } from './pieces.component';
import { RunwayComponent, STATIONS } from './runway.component';
import { WALK, WalkComponent } from './walk.component';

describe('stepAt', () => {
  it('reparte el recorrido en tramos iguales', () => {
    expect(stepAt(0, 4)).toBe(0);
    expect(stepAt(0.24, 4)).toBe(0);
    expect(stepAt(0.25, 4)).toBe(1);
    expect(stepAt(0.99, 4)).toBe(3);
  });

  it('el final y lo que se sale del rango quedan en el primero o el último', () => {
    expect(stepAt(1, 4)).toBe(3);
    expect(stepAt(1.4, 4)).toBe(3);
    expect(stepAt(-0.2, 4)).toBe(0);
    expect(stepAt(0.5, 0)).toBe(0);
  });
});

describe('cycleFrame', () => {
  it('avanza un fotograma cada tantos píxeles y vuelve a empezar', () => {
    expect(cycleFrame(0, 12, 20)).toBe(0);
    expect(cycleFrame(39, 12, 20)).toBe(1);
    expect(cycleFrame(240, 12, 20)).toBe(0);
    expect(cycleFrame(250, 12, 20)).toBe(0);
    expect(cycleFrame(260, 12, 20)).toBe(1);
  });

  it('el sentido no importa y sin fotogramas siempre es el 0', () => {
    expect(cycleFrame(-60, 12, 20)).toBe(3);
    expect(cycleFrame(100, 0, 20)).toBe(0);
    expect(cycleFrame(100, 12, 0)).toBe(0);
  });
});

describe('secciones de la portada', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: CatalogApi, useValue: { all: () => Promise.resolve([]) } }] });
  });

  function text(component: unknown): HTMLElement {
    const fixture = TestBed.createComponent(component as never);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('la pista tiene una pieza, una entrada del índice y una leyenda por herramienta', () => {
    const el = text(RunwayComponent);
    expect(el.querySelectorAll('.piece')).toHaveLength(STATIONS.length);
    expect(el.querySelectorAll('.rail li')).toHaveLength(STATIONS.length);
    expect([...el.querySelectorAll('.caption h3')].map((h) => h.textContent?.trim())).toEqual(STATIONS.map((s) => s.name));
    // Solo la leyenda activa queda para los lectores de pantalla.
    expect(el.querySelectorAll('.caption:not([aria-hidden])')).toHaveLength(1);
  });

  it('el paseo recorre los seis estilos, cada uno con su paleta', () => {
    expect(WALK.map((w) => w.id).sort()).toEqual([...STYLE_IDS].sort());
    const el = text(WalkComponent);
    expect(el.querySelectorAll('.room')).toHaveLength(6);
    expect(el.querySelectorAll('.room img[alt]')).toHaveLength(6);
    expect(el.querySelectorAll('.swatches li').length).toBeGreaterThanOrEqual(6);
  });

  it('las piezas flotan dentro del escenario y el titular se parte en palabras', () => {
    for (const p of PIECES) {
      expect(p.x + p.w).toBeLessThanOrEqual(100);
      expect(p.depth).toBeGreaterThan(0);
    }
    const el = text(PiecesComponent);
    expect(el.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Cada pieza, a escala.');
    expect(el.querySelectorAll('.piece')).toHaveLength(PIECES.length);
  });
});
