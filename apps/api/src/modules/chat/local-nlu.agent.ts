/**
 * Agente local: el modelo propio de intención (servicio de IA, CPU) decide qué pide cada orden y
 * con qué parámetros; las herramientas de la DesignToolbox hacen el cambio. Sin LLM ni costo.
 *
 * - Acabados, luz, estilo, candados, baño privado, piezas vetadas y Recomendar: los resuelve él
 *   con los parámetros que extrajo (colores, patrón, brillo, altura...).
 * - Agregar, quitar o mover muebles y medidas del cuarto: se los pasa a las reglas, que ya saben
 *   buscar en el catálogo y entender "junto a la cama".
 * - Si alguna orden no la entiende con confianza (o faltan parámetros), no hace nada y lanza
 *   AgentDeclinedError: responde el siguiente de la cascada (Groq), con la escena intacta.
 */
import type { DesignToolbox, FinishSpecInput, NluParseResponse, NluSlots, ToolOutcome } from '@interiores/shared-types';
import type { IAiClient } from '../../ports/index.js';
import { AgentDeclinedError, type DesignAgent, type DesignAgentInput, type DesignAgentResult } from './design-agent.js';
import { RuleSession, splitClauses } from './rule-based.agent.js';

export interface LocalAgentOptions {
  minConfidence: number;
}

type Surface = 'floor' | 'walls' | 'ceiling' | 'wallTiles';
type SpecKind = FinishSpecInput['kind'];

const KIND_LABEL: Record<SpecKind, string> = {
  tile: 'Baldosa',
  wood: 'Madera',
  stone: 'Piedra',
  paint: 'Pintura',
  carpet: 'Moqueta',
  brick: 'Ladrillo',
  concrete: 'Cemento',
};

/** Lo que va bien en cada superficie cuando la persona solo dice colores ("piso azul"). */
const DEFAULT_KIND: Record<Surface, SpecKind> = { floor: 'tile', walls: 'paint', ceiling: 'paint', wallTiles: 'tile' };
const FURNITURE_INTENTS = new Set(['add_item', 'remove_item', 'move_item', 'room_size']);

export class LocalNluDesignAgent implements DesignAgent {
  readonly kind = 'local' as const;
  readonly available = true;

  constructor(
    private readonly ai: IAiClient,
    private readonly opts: LocalAgentOptions,
  ) {}

  async run({ message, toolbox, context, signal }: DesignAgentInput): Promise<DesignAgentResult> {
    const clauses = splitClauses(message, { commas: false });
    if (clauses.length === 0) throw new AgentDeclinedError('Mensaje vacío');
    let parsed: NluParseResponse[];
    try {
      parsed = await Promise.all(clauses.map((c) => this.ai.parseIntent({ text: c.text }, signal ? { signal } : {})));
    } catch (err) {
      throw new AgentDeclinedError(`Modelo local no disponible: ${(err as Error).message}`);
    }
    const unsure = parsed.find((p) => p.intent === 'other' || p.confidence < this.opts.minConfidence);
    if (unsure) throw new AgentDeclinedError(`Poca confianza (${unsure.intent} ${unsure.confidence})`);

    const session = new RuleSession(toolbox);
    for (const [i, p] of parsed.entries()) {
      if (FURNITURE_INTENTS.has(p.intent)) {
        const before = session.understoodCount;
        session.handle(clauses[i]!);
        if (session.understoodCount === before) throw new AgentDeclinedError(`Las reglas no entendieron "${clauses[i]!.text}"`);
        continue;
      }
      const outcomes = this.apply(p, toolbox, context.styleId);
      if (!outcomes) throw new AgentDeclinedError(`Faltan parámetros para ${p.intent}`);
      for (const out of outcomes) session.note(out);
    }
    return { reply: session.reply() };
  }

  /** Las herramientas que resuelven una orden, o null si faltan datos para hacerlo bien. */
  private apply({ intent, slots: s }: NluParseResponse, tb: DesignToolbox, styleId: DesignAgentInput['context']['styleId']): ToolOutcome[] | null {
    switch (intent) {
      case 'set_floor':
        return this.finish(tb, s.surface === 'wallTiles' ? 'wallTiles' : 'floor', s);
      case 'set_walls':
        return this.finish(tb, s.surface === 'wallTiles' ? 'wallTiles' : 'walls', s);
      case 'set_wall_tiles':
        return this.finish(tb, 'wallTiles', s);
      case 'set_ceiling':
        return this.finish(tb, 'ceiling', s);
      case 'set_lighting':
        if (!s.mood && !s.level) return null;
        return [tb.run('set_lighting', { ...(s.mood ? { mood: s.mood } : {}), ...(s.level ? { level: s.level } : {}), pin: true })];
      case 'set_style':
        // Un estilo nuevo es una propuesta entera con ese estilo fijado.
        if (!s.style) return null;
        return [tb.run('pin', { target: 'style', styleId: s.style }), tb.run('recommend', { intensity: 'total' })];
      case 'recommend':
        return [tb.run('recommend', { intensity: s.intensity ?? 'total' })];
      case 'pin': {
        const target = s.pinTarget;
        if (!target || target === 'palette') return null;
        if (target === 'style') {
          const id = s.style ?? styleId;
          return id ? [tb.run('pin', { target, styleId: id })] : null;
        }
        return [tb.run('pin', { target })];
      }
      case 'unpin':
        return s.pinTarget ? [tb.run('unpin', { target: s.pinTarget })] : null;
      case 'add_zone':
        if (s.zoneKind !== 'bathroom') return [notDone('Por ahora puedo añadir un baño privado; el vestidor y las demás zonas se dibujan en el plano')];
        return [tb.run('add_zone', { kind: 'bathroom', ...(s.preset ? { preset: s.preset } : {}) })];
      case 'avoid_item':
        return s.subcategory ? [tb.run('want_item', { subcategory: s.subcategory, avoid: true })] : null;
      case 'replicate_image':
        return [notDone('Adjunta la foto con el botón 📎 (o pégala) y la replico en tu cuarto')];
      default:
        return null;
    }
  }

  private finish(tb: DesignToolbox, surface: Surface, s: NluSlots): ToolOutcome[] | null {
    const colors = s.colors.map((c) => c.hex);
    const height = { ...(s.heightM ? { heightM: s.heightM } : {}), ...(s.fullHeight ? { fullHeight: true } : {}) };
    if (colors.length === 0) {
      // Sin colores vale un material de la biblioteca ("parquet de roble"), si lo hay.
      if (!s.base) return null;
      if (surface === 'wallTiles') return [tb.run('set_wall_tiles', { materialId: s.base, ...height })];
      const out = tb.run('set_finishes', { [surface]: s.base });
      return out.ok ? [out, tb.run('pin', { target: surface })] : [out];
    }
    const kind = s.finishKind ?? DEFAULT_KIND[surface];
    const gloss = s.gloss ?? (kind === 'tile' ? 0.5 : undefined);
    const spec: FinishSpecInput = {
      name: specName(kind, gloss, s.colors.map((c) => c.name)),
      kind,
      colors,
      pattern: s.pattern ?? (colors.length > 1 ? 'mosaic' : kind === 'tile' ? 'grid' : kind === 'wood' ? 'planks' : 'plain'),
      ...(gloss !== undefined ? { gloss } : {}),
      ...(s.base ? { base: s.base } : {}),
      ...(s.tileSizeM ? { tileSizeM: s.tileSizeM } : {}),
    };
    return [tb.run('set_finish_spec', { surface, spec, ...(surface === 'wallTiles' ? height : {}) })];
  }
}

/** "Baldosa brillante azul claro y verde" (máx. 60 caracteres, como pide el esquema). */
export function specName(kind: SpecKind, gloss: number | undefined, colorNames: string[]): string {
  const finish = gloss === undefined ? '' : gloss >= 0.7 ? ' brillante' : gloss <= 0.15 ? ' mate' : '';
  const colors = colorNames.length ? ` ${colorNames.length > 1 ? `${colorNames.slice(0, -1).join(', ')} y ${colorNames.at(-1)}` : colorNames[0]}` : '';
  return `${KIND_LABEL[kind]}${finish}${colors}`.slice(0, 60);
}

function notDone(summary: string): ToolOutcome {
  return { ok: false, summary, content: JSON.stringify({ error: summary }) };
}
