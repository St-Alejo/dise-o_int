// Prueba de humo del backend completo a través de nginx (sin navegador).
//   node e2e/smoke.mjs [baseUrl]
// Registra un usuario, sube una foto, espera el pipeline de IA y verifica el resultado.
import { readFile } from 'node:fs/promises';

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:8080';
const email = `smoke-${Date.now()}@example.com`;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`✓ ${msg}`);
const json = { 'content-type': 'application/json' };

async function api(path, { token, ...init } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, body, headers: res.headers };
}

const ready = await api('/health/ready');
if (ready.status !== 200) fail(`/health/ready → ${ready.status} ${JSON.stringify(ready.body)}`);
ok('dependencias sanas (db, redis, s3, ia)');

const reg = await api('/auth/register', {
  method: 'POST',
  headers: json,
  body: JSON.stringify({ email, password: 'contraseña-segura-123', displayName: 'Smoke' }),
});
if (reg.status !== 201) fail(`registro → ${reg.status} ${JSON.stringify(reg.body)}`);
if (!/HttpOnly/i.test(reg.headers.get('set-cookie') ?? '')) fail('el refresh token no viene en cookie HttpOnly');
const token = reg.body.accessToken;
ok('registro + cookie de refresh HttpOnly');

const unauth = await api('/projects');
if (unauth.status !== 401 || unauth.body.status !== 401) fail(`sin token debería ser 401 problem+json, fue ${unauth.status}`);
ok('rutas protegidas devuelven 401 (RFC 7807)');

const bogus = new FormData();
bogus.append('photo', new Blob([Buffer.from('MZ' + 'x'.repeat(4000))], { type: 'image/jpeg' }), 'virus.jpg');
const rejected = await api('/projects', { method: 'POST', body: bogus, token });
if (rejected.status !== 415) fail(`un .exe renombrado debería dar 415, fue ${rejected.status}`);
ok('rechaza archivos que no son imágenes (415)');

const form = new FormData();
form.append('name', 'Sala de prueba');
form.append('roomType', 'living');
form.append('styles', 'escandinavo,industrial');
const photo = await readFile(new URL('./fixtures/room.jpg', import.meta.url));
form.append('photo', new Blob([photo], { type: 'image/jpeg' }), 'room.jpg');
const created = await api('/projects', { method: 'POST', body: form, token });
if (created.status !== 201) fail(`crear proyecto → ${created.status} ${JSON.stringify(created.body)}`);
const id = created.body.id;
ok(`proyecto creado (${id}), estado ${created.body.status}`);

const started = Date.now();
let project;
for (;;) {
  project = (await api(`/projects/${id}`, { token })).body;
  if (project.status === 'ready' || project.status === 'failed') break;
  if (Date.now() - started > 120_000) fail('el pipeline no terminó en 2 minutos');
  await new Promise((r) => setTimeout(r, 1000));
}
if (project.status !== 'ready') fail(`pipeline falló: ${project.lastError}`);
ok(`pipeline completo en ${((Date.now() - started) / 1000).toFixed(1)} s`);

const progress = (await api(`/projects/${id}/progress`, { token })).body;
const stages = [...new Set(progress.map((e) => e.stage))];
for (const s of ['queued', 'geometry', 'surfaces', 'styles', 'scene', 'done']) {
  if (!stages.includes(s)) fail(`falta la etapa de progreso "${s}" (hay: ${stages.join(', ')})`);
}
ok(`progreso real por etapas: ${stages.join(' → ')}`);

const shell = project.roomShell;
if (!shell?.needsCalibration) fail('el RoomShell debería pedir calibración');
ok(`RoomShell ${shell.widthM}×${shell.depthM}×${shell.heightM} m (confianza ${shell.scaleConfidence})`);

const readyPreviews = project.stylePreviews.filter((p) => p.status === 'ready');
if (readyPreviews.length !== 2) fail(`se esperaban 2 previews listas, hay ${readyPreviews.length}`);
const img = await fetch(`${BASE}${readyPreviews[0].imageUrl}`);
if (img.status !== 200 || img.headers.get('content-type') !== 'image/jpeg') fail(`preview no accesible: ${img.status}`);
const tampered = await fetch(`${BASE}${readyPreviews[0].imageUrl.replace(/sig=[^&]+/, 'sig=manipulada')}`);
if (tampered.status !== 403) fail(`una firma manipulada debería dar 403, dio ${tampered.status}`);
ok('previews Track A servidas con URL firmada (firma manipulada → 403)');

if (project.furniturePlacements.length < 3) fail(`muy pocos muebles colocados: ${project.furniturePlacements.length}`);
ok(`Track B: ${project.furniturePlacements.length} muebles colocados (estilo ${project.selectedStyleId})`);

const stale = await api(`/projects/${id}/scene`, {
  method: 'PUT',
  token,
  headers: json,
  body: JSON.stringify({ revision: project.revision - 1, furniturePlacements: [] }),
});
if (stale.status !== 409) fail(`revisión vieja debería dar 409, dio ${stale.status}`);
const moved = project.furniturePlacements.map((p, i) =>
  i === 0 ? { ...p, position: { ...p.position, x: p.position.x + 0.1 }, lockedByUser: true } : p,
);
const saved = await api(`/projects/${id}/scene`, {
  method: 'PUT',
  token,
  headers: json,
  body: JSON.stringify({ revision: project.revision, furniturePlacements: moved }),
});
if (saved.status !== 200) fail(`guardar escena → ${saved.status} ${JSON.stringify(saved.body)}`);
ok('guardar escena con control de concurrencia (revisión vieja → 409)');

const calibrated = await api(`/projects/${id}/calibrate`, {
  method: 'POST',
  token,
  headers: json,
  body: JSON.stringify({ revision: saved.body.revision, reference: 'ceiling-height', valueM: 2.7 }),
});
if (calibrated.status !== 200 || calibrated.body.roomShell.needsCalibration) fail(`calibrar → ${calibrated.status}`);
ok(`calibración: techo de 2.7 m → cuarto de ${calibrated.body.roomShell.widthM.toFixed(2)} m de ancho`);

const resized = await api(`/projects/${id}/room`, {
  method: 'PUT',
  token,
  headers: json,
  body: JSON.stringify({ revision: calibrated.body.revision, widthM: 3.2, depthM: 2.9, heightM: 2.45 }),
});
const rs = resized.body.roomShell;
if (resized.status !== 200 || rs.widthM !== 3.2 || rs.depthM !== 2.9 || rs.heightM !== 2.45) fail(`medidas exactas → ${resized.status} ${resized.body.detail ?? ''}`);
if (resized.body.furniturePlacements.length !== calibrated.body.furniturePlacements.length) fail('cambiar el cuarto no debe borrar muebles');
const badRoom = await api(`/projects/${id}/room`, {
  method: 'PUT',
  token,
  headers: json,
  body: JSON.stringify({ revision: resized.body.revision, widthM: 3.2, depthM: 2.9, heightM: 9 }),
});
if (badRoom.status !== 400 && badRoom.status !== 422) fail(`un techo de 9 m debería rechazarse, dio ${badRoom.status}`);
ok('medidas exactas: 3.20 × 2.90 × 2.45 m sin perder muebles (techo de 9 m → rechazado)');

const version = await api(`/projects/${id}/versions`, { method: 'POST', token, headers: json, body: JSON.stringify({ note: 'smoke' }) });
if (version.status !== 201 || !version.body.saved) fail(`guardar versión → ${version.status}`);
ok('versión guardada (el proyecto ya no se borra por retención)');

const share = await api(`/projects/${id}/share`, { method: 'POST', token });
const pub = await api(`/public/${share.body.token}`);
if (pub.status !== 200 || 'ownerId' in pub.body) fail(`vista pública → ${pub.status}`);
ok('link público de solo lectura (sin datos del dueño)');

const pdf = await api(`/projects/${id}/shopping-list.pdf`, { token });
if (pdf.status !== 200 || !Buffer.from(pdf.body).subarray(0, 4).equals(Buffer.from('%PDF'))) fail('PDF inválido');
ok(`lista de compras en PDF (${(pdf.body.byteLength / 1024).toFixed(0)} KB)`);

const del = await api(`/projects/${id}`, { method: 'DELETE', token });
const gone = await fetch(`${BASE}${readyPreviews[0].imageUrl}`);
if (del.status !== 204 || gone.status !== 404) fail(`borrado real: delete ${del.status}, archivo ${gone.status}`);
ok('borrado real: proyecto y archivos en S3 eliminados');

console.log('\nPrueba de humo superada.');
