/**
 * Movimiento de la portada: GSAP + ScrollTrigger se cargan solo aquí (chunk de la home), nunca en el
 * bundle inicial. Con movimiento reducido no se carga nada y cada sección se ve quieta.
 */
export type Gsap = typeof import('gsap').gsap;
export type ScrollTriggerT = typeof import('gsap/ScrollTrigger').ScrollTrigger;

let loading: Promise<{ gsap: Gsap; ScrollTrigger: ScrollTriggerT }> | null = null;

export function reducedMotion(): boolean {
  return typeof matchMedia === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function loadMotion(): Promise<{ gsap: Gsap; ScrollTrigger: ScrollTriggerT }> {
  loading ??= Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([g, st]) => {
    g.gsap.registerPlugin(st.ScrollTrigger);
    return { gsap: g.gsap, ScrollTrigger: st.ScrollTrigger };
  });
  return loading;
}

/** Índice del tramo activo cuando el recorrido 0..1 se reparte en `count` tramos iguales. */
export function stepAt(progress: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(Math.min(1, Math.max(0, progress)) * count)));
}

/** Fotograma de un ciclo que se repite (el paso de la persona): avanza con la distancia recorrida. */
export function cycleFrame(distance: number, frames: number, perFrame: number): number {
  if (frames <= 0 || perFrame <= 0) return 0;
  const i = Math.floor(Math.abs(distance) / perFrame) % frames;
  return i;
}

/**
 * Scroll suave con Lenis, solo en la portada y solo con rueda o trackpad (en táctil se deja el
 * nativo). Va con el reloj de GSAP para que ScrollTrigger lea la misma posición en cada cuadro.
 * Devuelve la función que lo apaga al salir de la página.
 */
export function smoothScroll(): Promise<() => void> {
  return Promise.all([loadMotion(), import('lenis')]).then(([{ gsap, ScrollTrigger }, { default: Lenis }]) => {
    // Sin `anchors`: los enlaces de la cabecera los resuelve el router, que mueve el scroll nativo y
    // Lenis lo sigue.
    const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 0.9, autoRaf: false });
    lenis.on('scroll', ScrollTrigger.update);
    const tick = (time: number): void => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
    };
  });
}
