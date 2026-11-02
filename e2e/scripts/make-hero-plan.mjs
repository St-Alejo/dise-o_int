// Plano de amoblamiento de la sala del encabezado (la plantilla sala-escandinava), dibujado con el
// mismo motor de planos del Modo Pro y pasado a trazo claro para leerse sobre fondo oscuro.
// Desde la raíz, con shared-types compilado y el stack levantado (para leer el catálogo):
//   node e2e/scripts/make-hero-plan.mjs [baseUrl]
import { readFile, writeFile } from 'node:fs/promises';
import { defaultTechnicalSpec, effectiveDimensions, LAYER_COLORS, planView, renderSvg } from '@interiores/shared-types';

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:8088';
const scene = JSON.parse(await readFile('apps/web/public/escenas/sala-escandinava.json', 'utf8'));
const ids = [...new Set(scene.furniturePlacements.map((p) => p.catalogItemId))];
const items = new Map(await Promise.all(ids.map(async (id) => [id, await (await fetch(`${BASE}/api/catalog/${id}`)).json()])));
const pieces = scene.furniturePlacements.flatMap((p) => {
  const it = items.get(p.catalogItemId);
  if (!it?.dimensionsM) return [];
  return [{ id: p.id, name: it.name, mount: it.mount, category: it.category, ...(it.subcategory ? { subcategory: it.subcategory } : {}), position: p.position, rotationY: p.rotationY, dims: effectiveDimensions(it.dimensionsM, p), ...(p.supportId ? { supportId: p.supportId } : {}) }];
});
const spec = defaultTechnicalSpec();
const drawing = planView('furniture', { shell: scene.roomShell, spec, pieces, finishes: scene.finishes, roomName: 'Sala escandinava' });
let svg = renderSvg(drawing, { scale: spec.sheet.scale, padding: 0.6, title: 'Plano de amoblamiento de la sala' }).replace(/ width="[0-9.]*mm" height="[0-9.]*mm"/, '');

// Trazo claro: los negros pasan a hueso, los grises a gris claro y los colores de capa a tonos suaves.
const LIGHT = { '#111111': '#f2ede4', '#222222': '#e6e0d5', '#333333': '#cfc8bb', '#5a5a5a': '#d9d2c5', '#8a8a8a': '#8f897f', '#9a9a9a': '#8f897f', '#b5b5b5': '#5f5a53', '#2d6a3e': '#9fd1ad', '#1b6f96': '#9fcfe6' };
for (const color of new Set(Object.values(LAYER_COLORS))) {
  const to = LIGHT[color];
  if (to) svg = svg.split(color).join(to);
}
svg = svg.replace(/fill="#fff(fff)?"/gi, 'fill="none"');
await writeFile('apps/web/public/landing/plano-sala.svg', svg);
console.log(`✓ plano-sala.svg: ${pieces.length} piezas, ${(svg.length / 1024).toFixed(0)} kB`);
