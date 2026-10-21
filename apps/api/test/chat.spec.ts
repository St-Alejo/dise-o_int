/** Fase 4: chat de diseño — agente por reglas, agente con Claude (cliente falso) y caso de uso. */
import { describe, expect, it } from 'vitest';
import {
  DesignToolbox,
  createRectangularShell,
  type CatalogItem,
  type DesignOperation,
  type FurniturePlacement,
} from '@interiores/shared-types';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { StaleRevisionError } from '../src/common/errors.js';
import type { ProjectRecord } from '../src/ports/index.js';
import type { CatalogService } from '../src/modules/catalog/catalog.service.js';
import type { ProjectsService } from '../src/modules/projects/projects.service.js';
import { ChatService } from '../src/modules/chat/chat.service.js';
import { ClaudeDesignAgent, buildTools, historyToMessages, type MessagesApi } from '../src/modules/chat/claude.agent.js';
import { AgentDeclinedError, AgentUnavailableError, type DesignAgent } from '../src/modules/chat/design-agent.js';
import { RuleBasedDesignAgent, parsePlacement, splitClauses } from '../src/modules/chat/rule-based.agent.js';
import sharp from 'sharp';
import type { NluParseResponse } from '@interiores/shared-types';
import { PhotoProcessor } from '../src/infrastructure/imaging/photo-processor.js';
import { MemoryFileStorage } from '../src/infrastructure/storage/memory-file-storage.js';
import type { ChatAgents } from '../src/modules/chat/chat.service.js';
import { GroqDesignAgent, buildGroqTools, type FetchLike } from '../src/modules/chat/groq.agent.js';
import { LocalNluDesignAgent, specName } from '../src/modules/chat/local-nlu.agent.js';
import { FakeAi, FakeQuota } from './fakes.js';

const item = (over: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'name' | 'category' | 'dimensionsM'>): CatalogItem => ({
  styleTags: [],
  roomTypes: [],
  mount: 'floor',
  modelUrl: '/m.glb',
  currency: 'USD',
  license: 'cc0',
  tags: [],
  synonyms: [],
  ...over,
});

const CATALOG: CatalogItem[] = [
  item({ id: 'bed', name: 'Cama doble', category: 'bed', tags: ['cama'], dimensionsM: { x: 1.6, y: 1.0, z: 2.1 } }),
  item({ id: 'nightstand', name: 'Mesa de noche', category: 'table', subcategory: 'nightstand', tags: ['mesita', 'velador'], dimensionsM: { x: 0.5, y: 0.55, z: 0.4 } }),
  item({ id: 'table-lamp', name: 'Lámpara de mesa', category: 'lighting', subcategory: 'table-lamp', mount: 'surface', tags: ['lampara', 'luz'], dimensionsM: { x: 0.3, y: 0.5, z: 0.3 } }),
  item({ id: 'floor-lamp', name: 'Lámpara de pie', category: 'lighting', subcategory: 'floor-lamp', tags: ['lampara', 'pie'], dimensionsM: { x: 0.4, y: 1.6, z: 0.4 } }),
  item({ id: 'rug', name: 'Alfombra rectangular', category: 'textile', subcategory: 'rug', tags: ['alfombra', 'tapete'], dimensionsM: { x: 2, y: 0.01, z: 1.4 } }),
  item({ id: 'desk', name: 'Escritorio', category: 'table', subcategory: 'desk', tags: ['escritorio'], dimensionsM: { x: 1.2, y: 0.75, z: 0.6 }, allowsUnder: true }),
  item({ id: 'chair', name: 'Silla', category: 'chair', tags: ['silla'], dimensionsM: { x: 0.45, y: 0.85, z: 0.5 }, tucksUnder: true }),
  item({ id: 'art', name: 'Cuadro abstracto', category: 'wall-decor', mount: 'wall', tags: ['cuadro', 'arte'], elevationDefaultM: 1.3, dimensionsM: { x: 0.8, y: 0.6, z: 0.03 } }),
  item({
    id: 'sofa',
    name: 'Sofá tres puestos',
    category: 'sofa',
    tags: ['sofa', 'sillon'],
    dimensionsM: { x: 2.1, y: 0.84, z: 0.92 },
    materialSlots: [{ slot: 'tapizado', label: 'Tapizado', default: 'fabric-linen-sand', allowedKinds: ['fabric', 'leather'] }],
  }),
];

const place = (id: string, catalogItemId: string, x: number, z: number, rotationY = 0): FurniturePlacement => ({
  id,
  catalogItemId,
  position: { x, y: 0, z },
  rotationY,
  lockedByUser: true,
});

const SCENE = (): FurniturePlacement[] => [
  place('bed1', 'bed', 2.25, 1.06),
  place('rug1', 'rug', 2.25, 2.9),
  place('desk1', 'desk', 4.5 - 0.31, 3.2, -Math.PI / 2),
  place('sofa1', 'sofa', 0.47, 2.8, Math.PI / 2),
];

function toolbox(placements = SCENE()) {
  let n = 0;
  return new DesignToolbox({ shell: createRectangularShell(4.5, 4.5, 2.6), placements, finishes: null, catalog: CATALOG, newId: () => `n${++n}` });
}

async function rules(message: string, tb = toolbox()): Promise<{ reply: string; ops: DesignOperation[]; tb: DesignToolbox }> {
  const { reply } = await new RuleBasedDesignAgent().run({ message, history: [], toolbox: tb, context: { roomType: 'bedroom', styleId: null } });
  return { reply, ops: tb.operations(), tb };
}

describe('RuleBasedDesignAgent (español, sin red)', () => {
  it('separa órdenes encadenadas sin romper los decimales', () => {
    expect(splitClauses('Agrega una silla, luego quita la alfombra y gira el sofá. El cuarto mide 4,5 x 3.2').map((c) => c.text)).toEqual([
      'agrega una silla',
      'quita la alfombra',
      'gira el sofa',
      'el cuarto mide 4.5 x 3.2',
    ]);
    expect(parsePlacement('dos sillas frente al escritorio')).toMatchObject({ count: 2, object: 'sillas', relation: 'in-front-of', ref: 'escritorio' });
  });

  it('"agrega una mesa de noche a la derecha de la cama"', async () => {
    const { ops, reply } = await rules('Agrega una mesa de noche a la derecha de la cama');
    expect(reply).toMatch(/Agregué Mesa de noche/);
    expect(ops).toEqual([{ op: 'add', placement: expect.objectContaining({ catalogItemId: 'nightstand', origin: 'chat' }) }]);
    const p = (ops[0] as { placement: FurniturePlacement }).placement;
    expect(p.position.x).toBeGreaterThan(2.25 + 0.8);
  });

  it('la lámpara de mesa "junto a la cama" se apoya en la mesa de noche', async () => {
    const tb = toolbox([...SCENE(), place('ns1', 'nightstand', 3.4, 0.2)]);
    const { ops } = await rules('pon una lámpara de mesa junto a la cama', tb);
    expect(ops).toEqual([{ op: 'add', placement: expect.objectContaining({ catalogItemId: 'table-lamp', supportId: 'ns1' }) }]);
  });

  it('un cuadro "encima del sofá" va colgado en la pared', async () => {
    const { ops } = await rules('coloca un cuadro encima del sofá');
    expect(ops[0]).toMatchObject({ op: 'add', placement: { catalogItemId: 'art', wallId: expect.any(String) } });
  });

  it('cantidades, quitar, girar y agrandar', async () => {
    const { ops, reply } = await rules('agrega dos sillas frente al escritorio; quita la alfombra; gira el sofá 90 grados; agranda la cama');
    expect(reply).not.toMatch(/✗/);
    expect(ops.filter((o) => o.op === 'add')).toHaveLength(2);
    expect(ops).toContainEqual({ op: 'remove', id: 'rug1' });
    const sofa = ops.find((o) => o.op === 'update' && o.placement.id === 'sofa1') as { placement: FurniturePlacement } | undefined;
    expect(sofa?.placement.rotationY).toBeCloseTo(Math.PI);
    const bed = ops.find((o) => o.op === 'update' && o.placement.id === 'bed1') as { placement: FurniturePlacement } | undefined;
    expect(bed?.placement.dimensionsM?.x).toBeGreaterThan(1.6);
  });

  it('acabados: "pinta las paredes de verde salvia y el piso de nogal"', async () => {
    const { ops } = await rules('Pinta las paredes de verde salvia y el piso de nogal');
    expect(ops).toEqual([{ op: 'finishes', finishes: { floor: 'wood-walnut', walls: { all: 'paint-sage' }, ceiling: 'paint-white' } }]);
  });

  it('materiales de un mueble: "tapiza el sofá de terciopelo verde"', async () => {
    const { ops } = await rules('tapiza el sofá de terciopelo verde');
    expect(ops).toEqual([{ op: 'update', placement: expect.objectContaining({ id: 'sofa1', materials: { tapizado: 'fabric-velvet-green' } }) }]);
  });

  it('medidas del cuarto: "el cuarto mide 5 x 4,2 y alto 2,7"', async () => {
    const { ops } = await rules('el cuarto mide 5 x 4,2 y alto 2,7');
    expect(ops[0]).toEqual({ op: 'room', widthM: 5, depthM: 4.2, heightM: 2.7 });
  });

  it('pronombres: "agrega una lámpara de pie junto al sofá y muévela junto a la cama"', async () => {
    const { ops } = await rules('agrega una lámpara de pie junto al sofá y muévela junto a la cama');
    const lamp = ops.find((o) => o.op === 'add') as { placement: FurniturePlacement };
    expect(lamp.placement.catalogItemId).toBe('floor-lamp');
    expect(Math.abs(lamp.placement.position.z - 1.06)).toBeLessThan(1.2); // terminó al lado de la cama
  });

  it('si no entiende, da ejemplos; si no encuentra algo, lo dice', async () => {
    expect((await rules('hola, ¿qué tal?')).reply).toMatch(/Prueba con órdenes/);
    const missing = await rules('quita el piano');
    expect(missing.reply).toMatch(/No encontré "piano"/);
    expect(missing.ops).toEqual([]);
  });
});

// --------------------------------------------------------------------------- Claude (cliente falso)
let blockSeq = 0;
function message(stop: BetaMessage['stop_reason'], content: unknown[]): BetaMessage {
  return { id: `msg_${++blockSeq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, content, usage: {} } as unknown as BetaMessage;
}
const toolUse = (name: string, input: unknown) => ({ type: 'tool_use', id: `tu_${++blockSeq}`, name, input });

class ScriptedMessages implements MessagesApi {
  calls: Parameters<MessagesApi['create']>[0][] = [];
  constructor(private readonly script: (BetaMessage | Error)[]) {}
  async create(params: Parameters<MessagesApi['create']>[0]) {
    this.calls.push(structuredClone(params));
    const next = this.script.shift();
    if (!next) throw new Error('guion agotado');
    if (next instanceof Error) throw next;
    return next;
  }
}

describe('ClaudeDesignAgent', () => {
  it('herramientas strict con schemas cerrados y sin restricciones numéricas', () => {
    const tools = buildTools();
    expect(tools.map((t) => t.name)).toContain('add_item');
    const walk = (s: unknown): void => {
      if (!s || typeof s !== 'object') return;
      const o = s as Record<string, unknown>;
      if (o['type'] === 'object') expect(o['additionalProperties']).toBe(false);
      expect(o).not.toHaveProperty('minimum');
      expect(o).not.toHaveProperty('maxLength');
      Object.values(o).forEach(walk);
    };
    for (const t of tools) {
      expect(t.strict).toBe(true);
      walk(t.input_schema);
    }
  });

  it('el historial empieza en el usuario, alterna y termina en el asistente', () => {
    expect(
      historyToMessages([
        { role: 'assistant', text: 'Hola' },
        { role: 'user', text: 'a' },
        { role: 'user', text: 'b' },
        { role: 'assistant', text: 'ok' },
        { role: 'user', text: 'colgado' },
      ]),
    ).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('bucle de herramientas: ejecuta, devuelve errores al modelo y responde con su texto', async () => {
    const api = new ScriptedMessages([
      message('tool_use', [
        { type: 'thinking', thinking: '', signature: 'sig' },
        toolUse('search_catalog', { query: 'lámpara de pie' }),
        toolUse('add_item', { catalogItemId: 'no-existe', relation: 'next-to', nearId: 'sofa1' }),
      ]),
      message('tool_use', [toolUse('add_item', { catalogItemId: 'floor-lamp', relation: 'next-to', nearId: 'sofa1' })]),
      message('end_turn', [{ type: 'text', text: 'Puse una lámpara de pie junto al sofá.' }]),
    ]);
    const agent = new ClaudeDesignAgent({ apiKey: undefined, model: 'claude-opus-5-5', messages: api });
    const tb = toolbox();
    const { reply } = await agent.run({ message: 'pon una lámpara de pie junto al sofá', history: [], toolbox: tb, context: { roomType: 'living', styleId: null } });

    expect(reply).toBe('Puse una lámpara de pie junto al sofá.');
    expect(tb.operations()).toEqual([{ op: 'add', placement: expect.objectContaining({ catalogItemId: 'floor-lamp' }) }]);
    expect(api.calls).toHaveLength(3);
    const first = api.calls[0]!;
    expect(first).toMatchObject({ model: 'claude-opus-5-5', thinking: { type: 'adaptive' }, fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
    expect(JSON.stringify(first.messages[0])).toContain('<escena>');
    // 2.ª llamada: el turno del asistente intacto (con el pensamiento) + los resultados en UN mensaje.
    const second = api.calls[1]!.messages;
    expect(second[1]).toMatchObject({ role: 'assistant', content: [{ type: 'thinking', signature: 'sig' }, {}, {}] });
    const results = second[2]!.content as { type: string; is_error?: boolean; content: string }[];
    expect(results.map((r) => r.type)).toEqual(['tool_result', 'tool_result']);
    expect(results[0]!.is_error).toBeUndefined();
    expect(results[1]).toMatchObject({ is_error: true, content: expect.stringMatching(/No existe el mueble/) });
  });

  it('tope de vueltas: cierra los tool_use y pide el resumen sin herramientas', async () => {
    const api = new ScriptedMessages([
      message('tool_use', [toolUse('get_scene', {})]),
      message('tool_use', [toolUse('get_scene', {})]),
      message('end_turn', [{ type: 'text', text: 'Revisé la escena.' }]),
    ]);
    const agent = new ClaudeDesignAgent({ apiKey: undefined, model: 'm', maxToolTurns: 2, messages: api });
    const { reply } = await agent.run({ message: 'mira', history: [], toolbox: toolbox(), context: { roomType: 'living', styleId: null } });
    expect(reply).toBe('Revisé la escena.');
    expect(api.calls[2]).toMatchObject({ tool_choice: { type: 'none' } });
  });

  it('un rechazo de seguridad se responde con un mensaje amable', async () => {
    const agent = new ClaudeDesignAgent({ apiKey: undefined, model: 'm', messages: new ScriptedMessages([message('refusal', [])]) });
    const { reply } = await agent.run({ message: '...', history: [], toolbox: toolbox(), context: { roomType: 'living', styleId: null } });
    expect(reply).toMatch(/No puedo ayudar/);
  });

  it('sin API key no está disponible', () => {
    expect(new ClaudeDesignAgent({ apiKey: undefined, model: 'm' }).available).toBe(false);
  });
});

// --------------------------------------------------------------------------- caso de uso
function project(over: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'p1',
    ownerId: 'alice',
    name: 'Cuarto',
    roomType: 'bedroom',
    status: 'ready',
    lastError: null,
    photoKey: null,
    photoHash: null,
    thumbKey: null,
    roomShell: createRectangularShell(4.5, 4.5, 2.6),
    placements: SCENE(),
    finishes: null,
    requestedRoom: null,
    selectedStyleId: null,
    requestedStyles: [],
    saved: false,
    revision: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function service(claude: DesignAgent, quota = new FakeQuota(5), record = project()) {
  const projects = { own: async () => record } as unknown as ProjectsService;
  const catalog = { all: async () => CATALOG } as unknown as CatalogService;
  return { svc: new ChatService(projects, catalog, { claude, rules: new RuleBasedDesignAgent() }, quota), quota };
}

const unavailable: DesignAgent = { kind: 'claude', available: false, run: async () => ({ reply: '' }) };

describe('ChatService', () => {
  const req = (message: string, revision = 3) => ({ revision, message, history: [] });

  it('sin API key responde el agente por reglas', async () => {
    const res = await service(unavailable).svc.chat({ userId: 'alice' }, 'p1', req('quita la alfombra'));
    expect(res).toMatchObject({ agent: 'rules', operations: [{ op: 'remove', id: 'rug1' }] });
  });

  it('si Claude falla, devuelve la cuota y usa las reglas con una toolbox limpia', async () => {
    const flaky: DesignAgent = {
      kind: 'claude',
      available: true,
      run: async ({ toolbox }) => {
        toolbox.run('remove_item', { id: 'bed1' }); // cambio a medias que NO debe salir
        throw new AgentUnavailableError('503');
      },
    };
    const { svc, quota } = service(flaky);
    const res = await svc.chat({ userId: 'alice' }, 'p1', req('quita la alfombra'));
    expect(res.agent).toBe('rules');
    expect(res.reply).toMatch(/no está disponible/);
    expect(res.operations).toEqual([{ op: 'remove', id: 'rug1' }]);
    expect(quota.used.get('alice')).toBe(0);
  });

  it('con cuota agotada avisa y responde con reglas', async () => {
    const claude: DesignAgent = { kind: 'claude', available: true, run: async () => ({ reply: 'claude' }) };
    const { svc } = service(claude, new FakeQuota(0));
    const res = await svc.chat({ userId: 'alice' }, 'p1', req('quita la alfombra'));
    expect(res).toMatchObject({ agent: 'rules', reply: expect.stringMatching(/límite/) });
  });

  it('Claude responde y sus cambios salen como operaciones', async () => {
    const claude: DesignAgent = {
      kind: 'claude',
      available: true,
      run: async ({ toolbox }) => {
        toolbox.run('set_finishes', { floor: 'stone-marble-white' });
        return { reply: 'Piso de mármol.' };
      },
    };
    const res = await service(claude).svc.chat({ userId: 'alice' }, 'p1', req('piso de mármol'));
    expect(res).toMatchObject({ agent: 'claude', reply: 'Piso de mármol.', operations: [{ op: 'finishes' }] });
  });

  it('revisión vieja → 409', async () => {
    await expect(service(unavailable).svc.chat({ userId: 'alice' }, 'p1', req('hola', 1))).rejects.toBeInstanceOf(StaleRevisionError);
  });
});

// --------------------------------------------------------------------------- cascada: local → Groq → reglas
const nluHit = (intent: NluParseResponse['intent'], slots: Partial<NluParseResponse['slots']> = {}, confidence = 0.93): Partial<NluParseResponse> => ({
  intent,
  confidence,
  slots: { colors: [], fullHeight: false, ...slots },
});

describe('LocalNluDesignAgent (modelo propio)', () => {
  const run = (ai: FakeAi, message: string, tb = toolbox()) =>
    new LocalNluDesignAgent(ai, { minConfidence: 0.75 }).run({ message, history: [], toolbox: tb, context: { roomType: 'bedroom', styleId: 'moderno' } });

  it('piso descrito con palabras: acabado propio, fijado, sin LLM', async () => {
    const ai = new FakeAi();
    ai.nlu.set('piso', nluHit('set_floor', { surface: 'floor', finishKind: 'tile', gloss: 0.85, colors: [{ name: 'azul claro', hex: '#a9d4ee' }, { name: 'verde', hex: '#4f8a52' }] }));
    const tb = toolbox();
    const { reply } = await run(ai, 'Quiero el piso de baldosa brillante, color azul claro con verde', tb);
    expect(reply).toMatch(/baldosa brillante azul claro y verde \(fijado\)/i);
    // La coma no partió la orden en dos.
    expect(ai.calls.filter((c) => c.startsWith('nlu:'))).toHaveLength(1);
    const ops = tb.operations();
    expect(ops.find((o) => o.op === 'brief')).toMatchObject({ brief: { surfaces: { floor: { locked: true, spec: { pattern: 'mosaic', gloss: 0.85 } } } } });
  });

  it('muebles y medidas se los pasa a las reglas; luz, veto y Recomendar los resuelve él', async () => {
    const ai = new FakeAi();
    ai.nlu.set('quita', nluHit('remove_item', { subcategory: 'rug' }));
    ai.nlu.set('luz', nluHit('set_lighting', { mood: 'calida', level: 'tenue' }));
    ai.nlu.set('cortinas', nluHit('avoid_item', { subcategory: 'curtain' }));
    ai.nlu.set('recomienda', nluHit('recommend', { intensity: 'suave' }));
    const tb = toolbox();
    const { reply } = await run(ai, 'quita la alfombra. luz cálida y tenue. nada de cortinas. recomienda solo colores', tb);
    expect(reply.split('\n')).toHaveLength(4);
    const ops = tb.operations();
    expect(ops).toContainEqual({ op: 'remove', id: 'rug1' });
    expect(ops.at(-1)).toEqual({ op: 'recommend', intensity: 'suave' });
    expect(ops.find((o) => o.op === 'brief')).toMatchObject({ brief: { avoid: ['curtain'], lighting: { mood: 'calida', locked: true } } });
  });

  it('estilo nuevo = fijarlo y pedir una propuesta completa; baño privado como zona', async () => {
    const ai = new FakeAi();
    ai.nlu.set('industrial', nluHit('set_style', { style: 'industrial' }));
    ai.nlu.set('bano', nluHit('add_zone', { zoneKind: 'bathroom', preset: 'banera-mampara' }));
    const tb = toolbox();
    await run(ai, 'hazlo industrial y agrega un baño privado con bañera', tb);
    const kinds = tb.operations().map((o) => o.op);
    expect(kinds[0]).toBe('zones');
    expect(kinds).toContain('brief');
    expect(kinds.at(-1)).toBe('recommend');
  });

  it('si duda, falta un dato o el servicio está caído, pasa el turno sin tocar nada', async () => {
    const ai = new FakeAi();
    ai.nlu.set('algo', nluHit('set_floor', {}, 0.5));
    await expect(run(ai, 'algo raro con el piso')).rejects.toBeInstanceOf(AgentDeclinedError);
    ai.nlu.set('luz', nluHit('set_lighting'));
    await expect(run(ai, 'cambia la luz')).rejects.toBeInstanceOf(AgentDeclinedError);
    await expect(run(ai, 'hola, qué tal')).rejects.toBeInstanceOf(AgentDeclinedError);
    ai.nluDown = true;
    await expect(run(ai, 'quita la alfombra')).rejects.toBeInstanceOf(AgentDeclinedError);
  });

  it('nombre del acabado', () => {
    expect(specName('tile', 0.85, ['azul claro', 'verde'])).toBe('Baldosa brillante azul claro y verde');
    expect(specName('wood', 0.1, ['roble'])).toBe('Madera mate roble');
    expect(specName('paint', undefined, ['a', 'b', 'c'])).toBe('Pintura a, b y c');
  });
});

/** fetch falso con respuestas en orden (o un estado de error). */
function scriptedFetch(answers: unknown[]) {
  const bodies: Record<string, unknown>[] = [];
  const fn: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    const next = answers.shift();
    if (typeof next === 'number') return { ok: false, status: next, json: async () => ({}), text: async () => 'rate limited' };
    return { ok: true, status: 200, json: async () => next, text: async () => '' };
  };
  return { fn, bodies };
}
const completion = (content: string | null, calls: { name: string; args: unknown }[] = []) => ({
  choices: [
    {
      finish_reason: calls.length ? 'tool_calls' : 'stop',
      message: { content, tool_calls: calls.length ? calls.map((c, i) => ({ id: `c${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) : undefined },
    },
  ],
});

describe('GroqDesignAgent', () => {
  const input = (tb = toolbox()) => ({ message: 'piso de mármol', history: [], toolbox: tb, context: { roomType: 'bedroom', styleId: null } });

  it('usa las herramientas con el formato de OpenAI y resume', async () => {
    const { fn, bodies } = scriptedFetch([completion(null, [{ name: 'set_finishes', args: { floor: 'stone-marble-white' } }]), completion('Puse piso de mármol.')]);
    const tb = toolbox();
    const agent = new GroqDesignAgent({ apiKey: 'k', model: 'm', fetch: fn });
    expect(agent.available).toBe(true);
    const { reply } = await agent.run(input(tb));
    expect(reply).toBe('Puse piso de mármol.');
    expect(tb.operations()).toEqual([expect.objectContaining({ op: 'finishes' })]);
    expect(bodies[0]).toMatchObject({ model: 'm', tool_choice: 'auto' });
    expect((bodies[1]!['messages'] as { role: string }[]).at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c0' });
    const tools = buildGroqTools();
    expect(tools.map((t) => t.function.name)).toContain('set_finish_spec');
    expect(tools[0]!.function.parameters).not.toHaveProperty('$schema');
  });

  it('un 429 no se reintenta, y tras tres fallos seguidos descansa', async () => {
    let now = 0;
    const { fn, bodies } = scriptedFetch([429, 503, 429]);
    const agent = new GroqDesignAgent({ apiKey: 'k', model: 'm', fetch: fn, now: () => now });
    for (let i = 0; i < 3; i++) await expect(agent.run(input())).rejects.toBeInstanceOf(AgentUnavailableError);
    expect(bodies).toHaveLength(3);
    expect(agent.available).toBe(false);
    now = 61_000;
    expect(agent.available).toBe(true);
    expect(new GroqDesignAgent({ apiKey: undefined, model: 'm' }).available).toBe(false);
  });
});

describe('ChatService en cascada', () => {
  const req = (message: string) => ({ revision: 3, message, history: [] });
  function cascade(agents: Partial<ChatAgents>, quota = new FakeQuota(5), ai = new FakeAi()) {
    const projects = { own: async () => project() } as unknown as ProjectsService;
    const catalog = { all: async () => CATALOG } as unknown as CatalogService;
    const reference = { ai, storage: new MemoryFileStorage(), photos: new PhotoProcessor(), maxBytes: 5_000_000 };
    return { svc: new ChatService(projects, catalog, { rules: new RuleBasedDesignAgent(), ...agents }, quota, reference), quota, ai, reference };
  }

  it('responde el modelo local sin gastar cuota', async () => {
    const ai = new FakeAi();
    ai.nlu.set('quita', nluHit('remove_item'));
    const groq: DesignAgent = { kind: 'groq', available: true, run: async () => ({ reply: 'groq' }) };
    const { svc, quota } = cascade({ local: new LocalNluDesignAgent(ai, { minConfidence: 0.75 }), groq });
    const res = await svc.chat({ userId: 'alice' }, 'p1', req('quita la alfombra'));
    expect(res).toMatchObject({ agent: 'local', operations: [{ op: 'remove', id: 'rug1' }] });
    expect(quota.used.get('alice') ?? 0).toBe(0);
  });

  it('si el local duda responde Groq (con cuota); si Groq cae, las reglas con aviso', async () => {
    const ai = new FakeAi();
    const local = new LocalNluDesignAgent(ai, { minConfidence: 0.75 });
    const groq: DesignAgent = {
      kind: 'groq',
      available: true,
      run: async ({ toolbox }) => {
        toolbox.run('set_lighting', { mood: 'fria' });
        return { reply: 'Luz fría.' };
      },
    };
    const ok = cascade({ local, groq });
    expect(await ok.svc.chat({ userId: 'alice' }, 'p1', req('algo que el local no sabe'))).toMatchObject({ agent: 'groq', reply: 'Luz fría.' });
    expect(ok.quota.used.get('alice')).toBe(1);

    const down: DesignAgent = { kind: 'groq', available: true, run: async () => Promise.reject(new AgentUnavailableError('429')) };
    const fallback = cascade({ local, groq: down });
    const res = await fallback.svc.chat({ userId: 'alice' }, 'p1', req('quita la alfombra'));
    expect(res).toMatchObject({ agent: 'rules', reply: expect.stringMatching(/no está disponible/) });
    expect(fallback.quota.used.get('alice')).toBe(0);
  });

  it('imagen de referencia: fija piso, paredes, estilo y luz y pide una propuesta', async () => {
    const { svc, ai, reference } = cascade({});
    const image = await sharp({ create: { width: 400, height: 320, channels: 3, background: '#a9d4ee' } }).jpeg().toBuffer();
    const res = await svc.fromReference({ userId: 'alice' }, 'p1', 3, image);
    expect(res.agent).toBe('groq');
    expect(res.reference).toEqual({ source: 'vision', palette: ai.reference.palette, style: 'escandinavo' });
    expect(res.reply).toMatch(/piso de baldosa, color de paredes, estilo escandinavo, luz/);
    const brief = res.operations.find((o) => o.op === 'brief');
    expect(brief).toMatchObject({ brief: { style: { id: 'escandinavo', locked: true }, surfaces: { floor: { locked: true }, walls: { locked: true } } } });
    expect(res.operations.at(-1)).toEqual({ op: 'recommend', intensity: 'total' });
    // La imagen quedó guardada bajo el proyecto (se borra con él).
    const key = ai.calls.find((c) => c.startsWith('reference:'))!.slice('reference:'.length);
    expect(key).toMatch(/^projects\/p1\/refs\/[0-9a-f]{24}\.jpg$/);
    expect(await reference.storage.exists(key)).toBe(true);
    await expect(svc.fromReference({ userId: 'alice' }, 'p1', 3, Buffer.from('no es imagen'))).rejects.toThrow(/JPG, PNG o WebP/);
  });
});
