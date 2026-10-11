// Genera las escenas de las plantillas amuebladas con el motor real y las deja en
// apps/web/public/escenas/<id>.json. Hay que tener el stack levantado.
//   node e2e/scripts/make-templates.mjs [baseUrl] [archivo-de-fichas.json] [carpeta-de-salida]
// Las fichas (id, nombre, tipo, estilo, planta) salen de FURNISHED_TEMPLATES en shared-types.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:8088';
const SPECS = process.argv[3] ?? 'plantillas.json';
const OUT = process.argv[4] ?? '../apps/web/public/escenas';
const json = { 'content-type': 'application/json' };

async function api(path, { token, ...init } = {}) {
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  const body = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(body)}`);
  return body;
}

const templates = JSON.parse(await readFile(SPECS, 'utf8'));
const { accessToken: token } = await api('/auth/register', {
  method: 'POST',
  headers: json,
  body: JSON.stringify({ email: `plantillas-${Date.now()}@example.test`, password: 'contraseña-segura-123', displayName: 'Plantillas' }),
});
await mkdir(OUT, { recursive: true });

for (const t of templates) {
  const form = new FormData();
  form.set('name', t.name);
  form.set('roomType', t.roomType);
  form.set('styles', t.styleId);
  form.set('roomSpec', JSON.stringify(t.spec));
  const { id } = await api('/projects', { method: 'POST', token, body: form });
  let project;
  for (let i = 0; i < 120; i++) {
    project = await api(`/projects/${id}`, { token });
    if (project.status === 'ready' || project.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (project.status !== 'ready') throw new Error(`${t.id}: el proyecto quedó en ${project.status}`);
  const scene = {
    id: t.id,
    name: t.name,
    roomType: t.roomType,
    styleId: t.styleId,
    roomShell: project.roomShell,
    furniturePlacements: project.furniturePlacements,
    finishes: project.finishes,
  };
  await writeFile(`${OUT}/${t.id}.json`, `${JSON.stringify(scene)}\n`);
  console.log(`✓ ${t.id}: ${scene.furniturePlacements.length} piezas`);
  await api(`/projects/${id}`, { method: 'DELETE', token });
}
