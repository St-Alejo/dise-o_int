import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Plano3dApi, peersLabel, type Plano3dLink } from '../../core/api/plano3d.api';
import { ConnectPlano3dPage, formatShareCode } from './connect-plano3d.page';

const LINK: Plano3dLink = {
  id: 'l1',
  homeId: '22222222-2222-4222-8222-222222222222',
  plano3dProjectId: 'prj_casa',
  projectName: 'Casa moderna',
  rooms: [
    { projectId: 'a', name: 'Sala · Piso 1', level: 'Piso 1' },
    { projectId: 'b', name: 'Alcoba · Piso 2', level: 'Piso 2' },
  ],
  live: true,
  peers: [],
  createdAt: '2026-11-16T12:00:00Z',
};

describe('Conectar con Plano 3D', () => {
  it('el código se escribe como lo muestra Plano 3D', () => {
    expect(formatShareCode('k7qm3xtp')).toBe('K7QM-3XTP');
    expect(formatShareCode(' K7QM 3XTP ')).toBe('K7QM-3XTP');
    expect(formatShareCode('k7q')).toBe('K7Q');
    expect(formatShareCode('K7QM-3XTP-EXTRA')).toBe('K7QM-3XTP');
  });

  const setup = async (codigo: string | undefined, link: (code: string) => Promise<Plano3dLink>) => {
    const asked: string[] = [];
    const api = {
      list: async () => [LINK],
      link: (code: string) => {
        asked.push(code);
        return link(code);
      },
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Plano3dApi, useValue: api }] });
    const router = TestBed.inject(Router);
    const navigated: unknown[][] = [];
    router.navigate = (async (commands: unknown[]) => {
      navigated.push(commands);
      return true;
    }) as Router['navigate'];
    const fixture = TestBed.createComponent(ConnectPlano3dPage);
    if (codigo) fixture.componentRef.setInput('codigo', codigo);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, asked, navigated };
  };

  it('llegar desde Plano 3D con el código conecta solo y abre la vivienda', async () => {
    const { asked, navigated, el } = await setup('k7qm3xtp', async () => LINK);
    expect(asked).toEqual(['K7QM-3XTP']);
    expect(navigated).toEqual([['/viviendas', LINK.homeId]]);
    expect(el.textContent).toContain('Casa moderna');
    expect(el.textContent).toContain('2 pisos');
  });

  it('si el código no existe lo dice y deja corregirlo', async () => {
    const { el, navigated } = await setup('ZZZZZZZZ', async () => {
      throw new Error('Ese código no existe');
    });
    expect(navigated).toEqual([]);
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.querySelector<HTMLInputElement>('#share-code')!.disabled).toBe(false);
  });
});

describe('peersLabel', () => {
  it('nombra a quienes están en Plano 3D, con su app', () => {
    expect(peersLabel([])).toBe('');
    expect(peersLabel([{ name: 'Ana', client: 'web' }])).toBe('Ana (web)');
    expect(peersLabel([{ name: 'Ana', client: 'web' }, { name: 'Beto', client: 'desktop' }, { name: 'Cris', client: 'web' }])).toBe('Ana (web), Beto (escritorio) y Cris (web)');
  });
});
