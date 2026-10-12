import { ToastService } from './toast.service';

describe('ToastService', () => {
  let frames: FrameRequestCallback[];
  /** Deja pasar un cuadro: corre lo que estaba esperando a que el navegador pintara. */
  const paint = () => frames.splice(0).forEach((frame) => frame(0));

  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('un aviso cuenta su tiempo desde que se pinta, no desde que se pide', () => {
    const toast = new ToastService();
    toast.success('Medidas del cuarto actualizadas.');
    // La página está ocupada (no pinta) más de lo que dura el aviso: sigue ahí.
    vi.advanceTimersByTime(20_000);
    expect(toast.toasts().map((t) => t.message)).toEqual(['Medidas del cuarto actualizadas.']);
    paint();
    paint();
    vi.advanceTimersByTime(4499);
    expect(toast.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toast.toasts()).toHaveLength(0);
  });

  it('un error con acción dura más, y ejecutarla lo cierra', () => {
    const toast = new ToastService();
    let retried = 0;
    toast.error('No se pudo guardar.', { label: 'Reintentar', run: () => retried++ });
    paint();
    paint();
    vi.advanceTimersByTime(11_000);
    expect(toast.toasts()).toHaveLength(1);
    toast.act(toast.toasts()[0]!);
    expect(retried).toBe(1);
    expect(toast.toasts()).toHaveLength(0);
  });

  it('solo se ven los cuatro últimos', () => {
    const toast = new ToastService();
    for (let i = 1; i <= 6; i++) toast.show(`aviso ${i}`);
    expect(toast.toasts().map((t) => t.message)).toEqual(['aviso 3', 'aviso 4', 'aviso 5', 'aviso 6']);
  });
});
