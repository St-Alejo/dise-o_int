import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRenderSpec, type JobProgressEvent, type Render } from '@interiores/shared-types';
import { RendersApi } from '../../core/api/renders.api';
import { ProgressService } from '../../core/realtime/progress.service';
import { ToastService } from '../../core/ui/toast.service';
import { DesignProjectStore } from '../project/design-project.store';
import { applyRenderProgress, comparisonFor, downloadName, engineLabel, specLabel } from './gallery';
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

  it('un .blend exportado se nombra como archivo, listo para renderizar', () => {
    const exported = render({ spec: { ...spec, purpose: 'export' } });
    expect(engineLabel(exported)).toBe('Archivo de Blender');
    expect(specLabel(exported.spec)).toBe('Tarde · 2K · Listo para renderizar');
    expect(downloadName('Sala', exported, 'blend')).toBe('sala-archivo-de-blender-tarde.blend');
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

describe('galería: antes y después', () => {
  const ready = (over: Partial<Render>) => render({ status: 'ready', url: `/api/media/${over.id}.jpg`, mediaType: 'image/jpeg', ...over });
  const blender = ready({ id: 'b1' });
  const browser = ready({ id: 'n1', provider: 'pathtracer', spec: { ...spec, engine: 'pathtracer' }, createdAt: '2026-11-03T09:00:00.000Z' });

  it('empareja Blender con el render del navegador de la misma vista, en los dos sentidos', () => {
    const newer = ready({ id: 'n2', provider: 'pathtracer', createdAt: '2026-11-03T09:30:00.000Z' });
    expect(comparisonFor(blender, [blender, browser, newer])).toEqual({ browser: newer, blender });
    expect(comparisonFor(browser, [blender, browser])).toEqual({ browser, blender });
  });

  it('no empareja otra vista, otra hora, dos del mismo motor ni lo que no está listo', () => {
    const moved = { ...spec, camera: { ...spec.camera, position: { x: 1.2, y: 1.6, z: 3 } } };
    expect(comparisonFor(blender, [ready({ id: 'n1', provider: 'pathtracer', spec: moved })])).toBeNull();
    expect(comparisonFor(blender, [ready({ id: 'n1', provider: 'pathtracer', spec: { ...spec, timeOfDay: 'night' } })])).toBeNull();
    expect(comparisonFor(blender, [ready({ id: 'b2' })])).toBeNull();
    expect(comparisonFor(blender, [render({ id: 'n1', provider: 'pathtracer' })])).toBeNull();
    // Un .blend exportado solo trae una miniatura: no sirve de "después".
    expect(comparisonFor(browser, [ready({ id: 'b3', spec: { ...spec, purpose: 'export' } })])).toBeNull();
    // A una cámara que se movió un centímetro todavía la cuenta como la misma vista.
    const nudged = { ...spec, camera: { ...spec.camera, position: { x: 1.01, y: 1.6, z: 3 } } };
    expect(comparisonFor(blender, [ready({ id: 'n1', provider: 'pathtracer', spec: nudged })])?.browser.id).toBe('n1');
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

  it('al terminar un .blend exportado lo descarga solo y el aviso permite repetirlo', async () => {
    api.list.mockResolvedValue([render({ spec: { ...spec, purpose: 'export' } })]);
    const fixture = await mount();
    const files = { png: '/api/media/x.png', blend: '/api/media/x.blend' };
    api.list.mockResolvedValue([render({ status: 'ready', url: '/api/media/x.jpg', mediaType: 'image/jpeg', spec: { ...spec, purpose: 'export' }, downloads: files })]);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    events.next(event({ status: 'completed', stage: 'done', pct: 100 }));
    await fixture.whenStable();
    expect(click).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith(expect.stringContaining('se está descargando'), 'success', 12000, expect.objectContaining({ label: 'Descargar otra vez' }));
    toast.show.mock.calls[0]![3].run();
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
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

  it('al abrir un render de Blender con su pareja del navegador muestra el antes y después', async () => {
    const blender = render({ status: 'ready', url: '/api/media/r1.jpg', mediaType: 'image/jpeg' });
    const browser = render({ id: 'n1', status: 'ready', url: '/api/media/n1.jpg', mediaType: 'image/jpeg', provider: 'pathtracer' });
    api.list.mockResolvedValue([blender, browser]);
    const fixture = await mount();
    fixture.componentInstance.open();
    await fixture.whenStable();
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[aria-label="Ver en grande: Blender"]')!.click();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect([...el.querySelectorAll('.compare img')].map((i) => i.getAttribute('src'))).toEqual(['/api/media/r1.jpg', '/api/media/n1.jpg']);
    const slider = el.querySelector<HTMLInputElement>('input[type="range"]')!;
    slider.value = '20';
    slider.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector<HTMLElement>('.compare')!.style.getPropertyValue('--split')).toBe('20%');
  });
});
