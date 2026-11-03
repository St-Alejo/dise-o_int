import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRenderSpec, type JobProgressEvent, type Render } from '@interiores/shared-types';
import { RendersApi } from '../../core/api/renders.api';
import { ProgressService } from '../../core/realtime/progress.service';
import { ToastService } from '../../core/ui/toast.service';
import { DesignProjectStore } from '../project/design-project.store';
import { applyRenderProgress, downloadName, engineLabel, specLabel } from './gallery';
import { RenderGalleryComponent } from './render-gallery.component';

const spec = { ...defaultRenderSpec({ position: { x: 1, y: 1.6, z: 3 }, target: { x: 2, y: 1, z: 0 }, focalMm: 24, straightVerticals: true }), timeOfDay: 'evening' as const, engine: 'cycles' as const };

const render = (over: Partial<Render> = {}): Render => ({
  id: 'r1',
  projectId: 'p1',
  kind: 'path',
  status: 'pending',
  mediaType: null,
  url: null,
  spec,
  sourceRenderId: null,
  fidelity: null,
  provider: 'cycles',
  shared: false,
  error: null,
  createdAt: '2026-11-03T10:00:00.000Z',
  ...over,
});

const event = (over: Partial<JobProgressEvent> = {}): JobProgressEvent => ({
  jobId: 'r1',
  projectId: 'p1',
  kind: 'blender-render',
  stage: 'rendering',
  pct: 40,
  message: 'Renderizando en Blender…',
  status: 'active',
  at: '2026-11-03T10:00:05.000Z',
  ...over,
});

describe('galería: etiquetas y avance', () => {
  it('nombra el motor y lo elegido en el estudio', () => {
    expect(engineLabel(render())).toBe('Blender');
    expect(engineLabel(render({ provider: 'pathtracer' }))).toBe('Trazado de rayos');
    expect(engineLabel(render({ kind: 'video' }))).toBe('Recorrido');
    expect(specLabel(spec)).toBe('Tarde · 2K · Buena');
    expect(downloadName('Sala de estar', render(), 'blend')).toBe('sala-de-estar-blender-tarde.blend');
  });

  it('lleva el avance de Blender y lo olvida al terminar; ignora otros trabajos y eventos viejos', () => {
    let map = applyRenderProgress(new Map(), event());
    expect(map.get('r1')?.pct).toBe(40);
    expect(applyRenderProgress(map, event({ kind: 'build-scene' }))).toBe(map);
    expect(applyRenderProgress(map, event({ pct: 10, at: '2026-11-03T10:00:01.000Z' }))).toBe(map);
    map = applyRenderProgress(map, event({ status: 'completed', pct: 100, at: '2026-11-03T10:00:30.000Z' }));
    expect(map.has('r1')).toBe(false);
  });
});

describe('RenderGalleryComponent', () => {
  const events = new Subject<JobProgressEvent>();
  const api = { list: vi.fn(), update: vi.fn(), remove: vi.fn(async () => {}) };
  const toast = { show: vi.fn(), error: vi.fn(), success: vi.fn() };
  const store = { project: signal<{ id: string; name: string } | null>({ id: 'p1', name: 'Sala' }) };

  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom no implementa los diálogos modales.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    api.list.mockResolvedValue([render()]);
    TestBed.configureTestingModule({
      imports: [RenderGalleryComponent],
      providers: [
        { provide: RendersApi, useValue: api },
        { provide: ProgressService, useValue: { watch: () => events.asObservable() } },
        { provide: ToastService, useValue: toast },
        { provide: DesignProjectStore, useValue: store },
      ],
    });
  });

  async function mount() {
    const fixture = TestBed.createComponent(RenderGalleryComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('al terminar un render pendiente avisa con un enlace a la galería', async () => {
    const fixture = await mount();
    expect(fixture.componentInstance.inProgress()).toBe(1);
    api.list.mockResolvedValue([render({ status: 'ready', url: '/api/media/x.jpg', mediaType: 'image/jpeg' })]);
    events.next(event({ status: 'completed', stage: 'done', pct: 100 }));
    await fixture.whenStable();
    expect(toast.show).toHaveBeenCalledWith('Tu render en Blender está listo', 'success', 8000, expect.objectContaining({ label: 'Ver' }));
    expect(fixture.componentInstance.inProgress()).toBe(0);
  });

  it('no vuelve a anunciar finales viejos que repite el historial', async () => {
    api.list.mockResolvedValue([render({ status: 'ready', url: '/x.jpg' })]);
    await mount();
    events.next(event({ status: 'completed', stage: 'done', pct: 100 }));
    expect(toast.show).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('un fallo se anuncia con el motivo', async () => {
    const fixture = await mount();
    api.list.mockResolvedValue([render({ status: 'failed', error: 'La GPU se quedó sin memoria' })]);
    events.next(event({ status: 'failed', error: 'La GPU se quedó sin memoria' }));
    await fixture.whenStable();
    expect(toast.error).toHaveBeenCalledWith('La GPU se quedó sin memoria', expect.objectContaining({ label: 'Ver' }));
  });

  it('muestra el avance en vivo y las descargas de Blender al abrir', async () => {
    const fixture = await mount();
    events.next(event({ pct: 63 }));
    fixture.componentInstance.open();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Renderizando… 63%');

    api.list.mockResolvedValue([
      render({ status: 'ready', url: '/api/media/r1.jpg', mediaType: 'image/jpeg', downloads: { png: '/api/media/r1.png', blend: '/api/media/r1.blend' } }),
    ]);
    await fixture.componentInstance.load();
    fixture.detectChanges();
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('a')].map((a) => a.getAttribute('download'));
    expect(links).toEqual(['sala-blender-tarde.png', 'sala-blender-tarde.blend']);
  });
});
