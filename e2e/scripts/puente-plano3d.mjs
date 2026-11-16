#!/usr/bin/env node
/**
 * Prueba de punta a punta del puente Plano 3D ↔ Interiores (ADR-0039), contra las dos apps
 * corriendo de verdad:
 *   1. Plano 3D (cuenta demo) comparte su casa y da un código.
 *   2. Interiores canjea el código: la casa aparece como vivienda con sus cuartos.
 *   3. Un sofá puesto en Interiores llega a Plano 3D como mueble `int_*`.
 *   4. En Plano 3D (sala en vivo) se mueve ese sofá y se achica un ambiente: Interiores lo recibe.
 *   5. Interiores no puede mover muros: Plano 3D rechaza el lote.
 *
 *   node e2e/scripts/puente-plano3d.mjs [P3D=http://localhost:8010] [INT=http://localhost:8088]
 *
 * Crea una cuenta de prueba nueva en Interiores en cada corrida (correo aleatorio).
 */
import { randomBytes } from 'node:crypto';

const P3D = process.env.P3D ?? 'http://localhost:8010';
const INT = process.env.INT ?? 'http://localhost:8088';
const PROJECT = process.env.P3D_PROJECT ?? 'prj_destacado_casa4';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
function check(cond, msg) {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    process.exit(1);
  }
}

async function call(base, path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${base}${path} → ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

async function until(what, fn, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Se agotó la espera: ${what}`);
    await sleep(250);
  }
}

/** Sala en vivo de Plano 3D como la abre la web (ticket de la sesión del dueño). */
async function ownerRoom(token, projectId) {
  const { ticket } = await call(P3D, '/api/auth/ws-ticket', { method: 'POST', token });
  const ws = new WebSocket(`${P3D.replace(/^http/, 'ws')}/api/ws/collab/${projectId}?ticket=${encodeURIComponent(ticket)}`);
  const inbox = [];
  ws.addEventListener('message', (ev) => inbox.push(JSON.parse(String(ev.data))));
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  ws.send(JSON.stringify({ type: 'hello', client: 'web', last_seq: null }));
  const welcome = await until('bienvenida de la sala', () => inbox.find((m) => m.type === 'welcome'));
  return {
    model: welcome.model,
    send: (ops) => {
      const opId = `e2e-${randomBytes(4).toString('hex')}`;
      ws.send(JSON.stringify({ type: 'ops', op_id: opId, ops }));
      return until('confirmación del lote', () => inbox.find((m) => (m.type === 'applied' || m.type === 'reject') && m.op_id === opId));
    },
    peers: () => inbox,
    close: () => ws.close(),
  };
}

console.log(`Puente Plano 3D (${P3D}) ↔ Interiores (${INT})`);

// 1. Plano 3D comparte la casa
const p3d = await call(P3D, '/api/auth/demo', { method: 'POST' });
const projects = await call(P3D, '/api/projects', { token: p3d.access_token });
const project = projects.find((p) => p.id === PROJECT) ?? projects[0];
check(project, 'la cuenta demo de Plano 3D no tiene proyectos');
const share = await call(P3D, `/api/projects/${project.id}/shares`, { method: 'POST', token: p3d.access_token, body: {} });
check(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(share.code), `código raro: ${share.code}`);
ok(`Plano 3D comparte «${project.name}» con el código ${share.code}`);

// 2. Interiores canjea el código
const email = `puente-${randomBytes(5).toString('hex')}@prueba.test`;
const session = await call(INT, '/api/auth/register', { method: 'POST', body: { email, password: randomBytes(12).toString('base64url'), displayName: 'Prueba puente' } });
const token = session.accessToken;
const link = await call(INT, '/api/plano3d/links', { method: 'POST', token, body: { code: share.code } });
const levels = [...new Set(link.rooms.map((r) => r.level))];
check(link.rooms.length > 0, 'la vivienda enlazada no tiene cuartos');
ok(`Interiores crea la vivienda «${link.projectName}»: ${link.rooms.length} cuartos en ${levels.length} pisos (${levels.join(', ')})`);
await until('sala en vivo abierta', async () => (await call(INT, '/api/plano3d/links', { token })).find((l) => l.id === link.id)?.live);
ok('la sala en vivo de Plano 3D queda abierta desde Interiores');

// 3. Un sofá de Interiores llega a Plano 3D
const target0 = link.rooms.find((r) => /^sala/i.test(r.name)) ?? link.rooms[0];
const room = await call(INT, `/api/projects/${target0.projectId}`, { token });
const catalog = await call(INT, '/api/catalog');
const sofa = catalog.find((c) => c.category === 'sofa') ?? catalog[0];
const placement = {
  id: 'e2e-sofa',
  catalogItemId: sofa.id,
  position: { x: Math.round((room.roomShell.widthM / 2) * 100) / 100, y: 0, z: Math.round((room.roomShell.depthM / 2) * 100) / 100 },
  rotationY: 0,
  lockedByUser: false,
};
await call(INT, `/api/projects/${room.id}/scene`, { method: 'PUT', token, body: { revision: room.revision, furniturePlacements: [...room.furniturePlacements, placement] } });
const roomRef = room.plano3d;
const furnitureId = `int-${roomRef.roomId}-e2e-sofa`;
const inPlano3d = await until('el sofá en Plano 3D', async () => {
  const full = await call(P3D, `/api/projects/${project.id}`, { token: p3d.access_token });
  return full.model.levels.flatMap((l) => l.furniture ?? []).find((f) => f.id === furnitureId);
});
check(inPlano3d.catalog_id === `int_${sofa.id}`, `catálogo inesperado: ${inPlano3d.catalog_id}`);
ok(`«${sofa.name}» puesto en «${room.name}» aparece en Plano 3D como ${inPlano3d.catalog_id} en (${inPlano3d.position.x}, ${inPlano3d.position.y})`);

// 4. Plano 3D mueve el sofá y agranda el ambiente; Interiores lo recibe
const live = await ownerRoom(p3d.access_token, project.id);
const level = live.model.levels.find((l) => l.rooms.some((r) => r.id === roomRef.roomId));
const moved = { ...inPlano3d, position: { x: inPlano3d.position.x + 0.5, y: inPlano3d.position.y } };
const t0 = Date.now();
const applied = await live.send([{ t: 'put', k: 'furniture', level: level.id, id: furnitureId, v: moved }]);
check(applied.type === 'applied', `Plano 3D rechazó mover el sofá: ${applied.reason}`);
const back = await until('el sofá movido en Interiores', async () => {
  const p = await call(INT, `/api/projects/${room.id}`, { token });
  const s = p.furniturePlacements.find((f) => f.id === 'e2e-sofa');
  return s && Math.abs(s.position.x - (placement.position.x + 0.5)) < 0.01 ? s : null;
});
ok(`moverlo 50 cm en Plano 3D lo mueve en Interiores (${Date.now() - t0} ms): x = ${back.position.x}`);

const target = level.rooms.find((r) => r.id === roomRef.roomId);
const minX = Math.min(...target.polygon.map((p) => p.x));
// achicarlo (y no agrandarlo) nunca lo hace pisar al vecino, que Plano 3D no dejaría
const narrowed = { ...target, polygon: target.polygon.map((p) => (p.x === minX ? { ...p, x: p.x + 0.3 } : p)) };
const t1 = Date.now();
const archOk = await live.send([{ t: 'put', k: 'room', level: level.id, id: target.id, v: narrowed }]);
check(archOk.type === 'applied', `Plano 3D rechazó su propio cambio: ${archOk.reason}`);
const wider = await until('el cuarto rehecho en Interiores', async () => {
  const p = await call(INT, `/api/projects/${room.id}`, { token });
  return p.roomShell.widthM < room.roomShell.widthM - 0.2 ? p : null;
});
ok(`achicar «${target.label}» 30 cm en Plano 3D rehace el cuarto en Interiores (${Date.now() - t1} ms): ${room.roomShell.widthM} → ${wider.roomShell.widthM} m`);
// se deja como estaba
await live.send([{ t: 'put', k: 'room', level: level.id, id: target.id, v: target }]);
live.close();

// 5. Interiores no puede tocar los muros
const blocked = await fetch(`${INT}/api/projects/${room.id}/room`, {
  method: 'PUT',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ revision: wider.revision, widthM: 9, depthM: 9, heightM: 2.6 }),
});
check(blocked.status === 422 || blocked.status === 400, `Interiores dejó cambiar las medidas (HTTP ${blocked.status})`);
ok(`Interiores no deja cambiar las medidas del cuarto (HTTP ${blocked.status}: se editan en Plano 3D)`);

console.log('\nPuente en vivo verificado.');
process.exit(0);
