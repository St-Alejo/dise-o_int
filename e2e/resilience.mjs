// Prueba de resiliencia (manual / CI opcional): requiere poder parar y arrancar el servicio de IA.
//   node e2e/resilience.mjs <baseUrl> <comando-parar-ia> <comando-arrancar-ia>
// Verifica: /ready → 503 con la IA caída; el job falla tras sus reintentos con un mensaje
// entendible; al volver la IA, "Reintentar" recupera el proyecto.
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const [BASE = 'http://localhost:8080', stopCmd, startCmd] = process.argv.slice(2);
if (!stopCmd || !startCmd) {
  console.error('Uso: node e2e/resilience.mjs <baseUrl> "<parar ia>" "<arrancar ia>"');
  process.exit(2);
}
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => {
  console.error(`✗ ${m}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, init = {}) => {
  const res = await fetch(`${BASE}/api${path}`, init);
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
};

const reg = await api('/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `res-${Date.now()}@example.test`, password: 'resiliencia-123', displayName: 'Res' }),
});
const auth = { authorization: `Bearer ${reg.body.accessToken}` };

execSync(stopCmd, { stdio: 'ignore' });
try {
  const ready = await api('/health/ready');
  if (ready.status !== 503 || ready.body?.error?.ai?.status !== 'down') fail(`/ready debería ser 503 con ai=down, fue ${ready.status}`);
  ok('/health/ready → 503 e indica que la IA está caída');

  const form = new FormData();
  form.append('styles', 'moderno');
  form.append('photo', new Blob([await readFile(new URL('./fixtures/room.jpg', import.meta.url))], { type: 'image/jpeg' }), 'r.jpg');
  const created = await api('/projects', { method: 'POST', body: form, headers: auth });
  if (created.status !== 201) fail(`crear proyecto con la IA caída → ${created.status}`);
  ok('la subida se acepta aunque la IA esté caída (el trabajo queda en cola)');

  let project;
  const t0 = Date.now();
  do {
    await sleep(2000);
    project = (await api(`/projects/${created.body.id}`, { headers: auth })).body;
  } while (project.status === 'processing' && Date.now() - t0 < 120_000);
  if (project.status !== 'failed') fail(`tras agotar reintentos debería estar "failed", está "${project.status}"`);
  ok(`tras los reintentos con backoff queda en error: "${project.lastError}"`);
  const events = (await api(`/projects/${created.body.id}/progress`, { headers: auth })).body;
  if (!events.some((e) => /reintentando/i.test(e.message))) fail('no se informó de los reintentos al usuario');
  ok('el usuario vio los reintentos en el progreso en vivo');

  execSync(startCmd, { stdio: 'ignore' });
  for (let i = 0; i < 30 && (await api('/health/ready')).status !== 200; i++) await sleep(2000);
  ok('la IA volvió: /health/ready → 200');

  const retried = await api(`/projects/${created.body.id}/retry`, { method: 'POST', headers: auth });
  if (retried.status !== 202) fail(`reintentar → ${retried.status}`);
  const t1 = Date.now();
  do {
    await sleep(1000);
    project = (await api(`/projects/${created.body.id}`, { headers: auth })).body;
  } while (project.status === 'processing' && Date.now() - t1 < 60_000);
  if (project.status !== 'ready') fail(`tras reintentar debería estar "ready", está "${project.status}"`);
  ok('"Reintentar" recupera el proyecto');
  console.log('\nPrueba de resiliencia superada.');
} finally {
  execSync(startCmd, { stdio: 'ignore' });
}
