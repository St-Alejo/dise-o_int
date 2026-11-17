import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { CASA_FLOORS, CASA_MIRADOR, CasaMiradorComponent, plano3dFeaturedUrl } from './casa-mirador.component';

describe('Casa Mirador', () => {
  it('tres pisos con interiores y cada cuarto con su render', () => {
    expect(CASA_FLOORS).toEqual([1, 2, 3]);
    expect(new Set(CASA_MIRADOR.map((r) => r.id)).size).toBe(CASA_MIRADOR.length);
  });

  it('el enlace a Plano 3D va a la casa destacada, local o publicada', () => {
    expect(plano3dFeaturedUrl('localhost')).toBe('http://localhost:5175/destacados/prj_destacado_casa4');
    expect(plano3dFeaturedUrl('ca-interiores-web.example.io')).toMatch(/^https:\/\/.+\/destacados\/prj_destacado_casa4$/);
  });

  it('las pestañas cambian los cuartos que se ven', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(CasaMiradorComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const titles = () => [...el.querySelectorAll('.rooms h3')].map((h) => h.textContent?.trim());
    expect(titles()).toEqual(['Sala doble altura', 'Cocina abierta de roble', 'Comedor de nogal']);
    const tabs = el.querySelectorAll<HTMLButtonElement>('[role=tab]');
    tabs[2]!.click();
    fixture.detectChanges();
    expect(titles()).toContain('Sala de cine');
    expect(tabs[2]!.getAttribute('aria-selected')).toBe('true');
  });
});
