// Plantilla profesional "dormitorio-obra": la escena del dormitorio luminoso más una ficha técnica
// con cajetín, perfil normativo de Colombia e instalaciones propuestas por la app.
// Se corre desde la raíz con shared-types compilado y el stack levantado (para leer el catálogo):
//   node e2e/scripts/make-pro-template.mjs [baseUrl]
import { readFile, writeFile } from 'node:fs/promises';
import { defaultTechnicalSpec, effectiveDimensions, FurnishedSceneSchema, proposeInstallations, TechnicalSpecSchema } from '@interiores/shared-types';

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:8088';
const DIR = 'apps/web/public/escenas';
const base = JSON.parse(await readFile(`${DIR}/dormitorio-luminoso.json`, 'utf8'));
const ids = [...new Set(base.furniturePlacements.map((p) => p.catalogItemId))];
const items = new Map(await Promise.all(ids.map(async (id) => [id, await (await fetch(`${BASE}/api/catalog/${id}`)).json()])));
const pieces = base.furniturePlacements.flatMap((p) => {
  const it = items.get(p.catalogItemId);
  if (!it?.dimensionsM) return [];
  return [{ id: p.id, name: it.name, mount: it.mount, category: it.category, ...(it.subcategory ? { subcategory: it.subcategory } : {}), position: p.position, rotationY: p.rotationY, dims: effectiveDimensions(it.dimensionsM, p), ...(p.supportId ? { supportId: p.supportId } : {}) }];
});
const spec = defaultTechnicalSpec();
const technical = TechnicalSpecSchema.parse({
  ...spec,
  titleBlock: { project: 'Remodelación dormitorio principal', client: 'Cliente de ejemplo', address: 'Calle 10 # 20-30, Bogotá', professional: 'Arq. de ejemplo', license: 'A-00000', revision: 'A' },
  compliance: { profile: 'colombia', accessible: false },
  installations: proposeInstallations({ shell: base.roomShell, pieces, roomType: 'bedroom', installations: spec.installations }),
});
const scene = FurnishedSceneSchema.parse({ ...base, id: 'dormitorio-obra', name: 'Dormitorio listo para obra', technical });
await writeFile(`${DIR}/dormitorio-obra.json`, `${JSON.stringify(scene)}\n`);
await writeFile(`${DIR}/dormitorio-obra.webp`, await readFile(`${DIR}/dormitorio-luminoso.webp`));
console.log(`✓ dormitorio-obra: ${pieces.length} piezas, ${technical.installations.points.length} puntos, ${technical.installations.circuits.length} circuitos`);
