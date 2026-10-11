import * as THREE from 'three';

/**
 * Texturas de penumbra (negro con transparencia) para los rincones del cuarto. Se dibujan una vez
 * y se comparten (Flyweight); sin canvas —en las pruebas— no hay ninguna y el cuarto va sin ellas.
 */
const SIZE = 256;
const cache = new Map<string, THREE.Texture | null>();

function draw(key: string, paint: (ctx: CanvasRenderingContext2D) => void): THREE.Texture | null {
  if (cache.has(key)) return cache.get(key)!;
  let texture: THREE.Texture | null = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (ctx) {
      paint(ctx);
      texture = new THREE.CanvasTexture(canvas);
    }
  }
  cache.set(key, texture);
  return texture;
}

/** Degradado de `alpha` a transparente, desde un borde del dibujo hacia dentro. */
function fade(ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number], alpha: number): void {
  const gradient = ctx.createLinearGradient(from[0], from[1], to[0], to[1]);
  gradient.addColorStop(0, `rgba(0,0,0,${alpha})`);
  gradient.addColorStop(0.45, `rgba(0,0,0,${alpha * 0.3})`);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

/** Para una pared: oscura en sus cuatro bordes (contra el piso, el techo y las paredes vecinas). */
export function cornerShade(): THREE.Texture | null {
  return draw('corner', (ctx) => {
    const reach = SIZE * 0.22;
    fade(ctx, [0, 0], [reach, 0], 0.8);
    fade(ctx, [SIZE, 0], [SIZE - reach, 0], 0.8);
    fade(ctx, [0, 0], [0, reach * 0.8], 0.7);
    fade(ctx, [0, SIZE], [0, SIZE - reach], 1);
  });
}

/** Para la franja de piso o de techo que corre junto a una pared: oscura del lado de la pared. */
export function edgeShade(): THREE.Texture | null {
  return draw('edge', (ctx) => fade(ctx, [0, 0], [0, SIZE], 1));
}
