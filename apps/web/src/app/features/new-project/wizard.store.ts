/**
 * Asistente de "nuevo proyecto" (lógica pura, sin DOM): tres pasos —de dónde sale el cuarto, su
 * forma y medidas, y el estilo— y lo que hay que enviar al terminar.
 *
 * Patrón State: cada paso es un objeto que sabe qué le falta para poder avanzar. El asistente no
 * conoce las reglas de ningún paso; solo pregunta al actual.
 */
import { computed, signal } from '@angular/core';
import {
  DEFAULT_STYLES,
  ROOM_LIMITS,
  ROOM_TEMPLATES,
  RoomGeometryError,
  RoomSpecSchema,
  buildRoomFromSpec,
  resolveNotch,
  type RoomDimensions,
  type RoomShapeId,
  type RoomShell,
  type RoomSpec,
  type RoomType,
  type StyleId,
} from '@interiores/shared-types';

/** De dónde sale el cuarto: de una foto o de la forma y medidas que elija el usuario. */
export type RoomSource = 'photo' | 'manual';
/** `auto` = la forma la decide la foto. */
export type ShapeChoice = RoomShapeId | 'auto';

export interface WizardData {
  source: RoomSource | null;
  photo: File | null;
  shape: ShapeChoice;
  widthM: number | null;
  depthM: number | null;
  heightM: number | null;
  notchWidthM: number | null;
  notchDepthM: number | null;
  name: string;
  roomType: RoomType;
  styles: StyleId[];
}

export type StepId = 'source' | 'room' | 'style';

export interface WizardStep {
  readonly id: StepId;
  readonly title: string;
  /** Lo que falta para poder avanzar, en palabras para el usuario; null si el paso está completo. */
  problem(data: WizardData): string | null;
}

/** Lo que se envía al crear el proyecto. */
export interface NewProjectRequest {
  photo: File | null;
  name: string;
  roomType: RoomType;
  styles: StyleId[];
  /** Medidas sueltas: acompañan a la foto cuando la forma la decide ella. */
  room?: RoomDimensions;
  /** Cuarto definido a mano. */
  roomSpec?: RoomSpec;
}

const DEFAULT_ROOM = { widthM: 4, depthM: 3.5, heightM: 2.5 };
const LABELS = { widthM: 'El ancho', depthM: 'El largo', heightM: 'El alto' } as const;
const round2 = (v: number) => Math.round(v * 100) / 100;

function dimensionProblem(data: WizardData): string | null {
  for (const key of ['widthM', 'depthM', 'heightM'] as const) {
    const v = data[key];
    const [lo, hi] = key === 'heightM' ? [ROOM_LIMITS.minHeightM, ROOM_LIMITS.maxHeightM] : [ROOM_LIMITS.minSideM, ROOM_LIMITS.maxSideM];
    if (v === null || !Number.isFinite(v)) return 'Escribe el ancho, el largo y el alto del cuarto.';
    if (v < lo || v > hi) return `${LABELS[key]} debe estar entre ${lo} y ${hi} m.`;
  }
  return null;
}

/** El cuarto que describe el borrador, o por qué todavía no se puede construir. */
export function roomOf(data: WizardData): { spec: RoomSpec | null; shell: RoomShell | null; problem: string | null } {
  if (data.shape === 'auto') return { spec: null, shell: null, problem: null };
  const problem = dimensionProblem(data);
  if (problem) return { spec: null, shell: null, problem };
  const dims = { widthM: data.widthM!, depthM: data.depthM!, heightM: data.heightM! };
  // La muesca se acota a lo que la forma admite: el plano muestra exactamente lo que se creará.
  const notch = resolveNotch(data.shape, { ...dims, ...(data.notchWidthM ? { notchWidthM: data.notchWidthM } : {}), ...(data.notchDepthM ? { notchDepthM: data.notchDepthM } : {}) });
  const parsed = RoomSpecSchema.safeParse({
    shape: data.shape,
    ...dims,
    ...(ROOM_TEMPLATES[data.shape].hasNotch ? { notchWidthM: round2(notch.widthM), notchDepthM: round2(notch.depthM) } : {}),
  });
  if (!parsed.success) return { spec: null, shell: null, problem: 'Revisa las medidas del cuarto.' };
  try {
    return { spec: parsed.data, shell: buildRoomFromSpec(parsed.data), problem: null };
  } catch (err) {
    return { spec: null, shell: null, problem: err instanceof RoomGeometryError ? err.message : 'Con esas medidas no se puede armar el cuarto.' };
  }
}

class SourceStep implements WizardStep {
  readonly id = 'source';
  readonly title = 'Tu cuarto';
  problem(data: WizardData): string | null {
    if (data.source === null) return 'Sube una foto o elige empezar sin foto.';
    return data.source === 'photo' && !data.photo ? 'Elige la foto de tu cuarto.' : null;
  }
}

class RoomStep implements WizardStep {
  readonly id = 'room';
  readonly title = 'Forma y medidas';
  problem(data: WizardData): string | null {
    if (data.shape !== 'auto') return roomOf(data).problem;
    // Con la forma en manos de la foto, las medidas son opcionales: las tres o ninguna.
    const written = [data.widthM, data.depthM, data.heightM].filter((v) => v !== null).length;
    if (written === 0) return null;
    return written < 3 ? 'Escribe ancho, largo y alto (o deja los tres vacíos).' : dimensionProblem(data);
  }
}

class StyleStep implements WizardStep {
  readonly id = 'style';
  readonly title = 'Tipo y estilo';
  problem(data: WizardData): string | null {
    if (!data.name.trim()) return 'Ponle un nombre al proyecto.';
    if (data.styles.length === 0) return 'Elige al menos un estilo.';
    return data.styles.length > 4 ? 'Elige como máximo cuatro estilos.' : null;
  }
}

export class NewProjectWizard {
  readonly steps: readonly WizardStep[] = [new SourceStep(), new RoomStep(), new StyleStep()];

  readonly data = signal<WizardData>({
    source: null,
    photo: null,
    shape: 'auto',
    widthM: null,
    depthM: null,
    heightM: null,
    notchWidthM: null,
    notchDepthM: null,
    name: 'Mi cuarto',
    roomType: 'living',
    styles: [...DEFAULT_STYLES],
  });
  readonly index = signal(0);

  readonly step = computed(() => this.steps[this.index()]!);
  readonly problem = computed(() => this.step().problem(this.data()));
  readonly isLast = computed(() => this.index() === this.steps.length - 1);
  /** El cuarto tal como quedará, para el plano de vista previa. */
  readonly room = computed(() => roomOf(this.data()));
  /** El asistente entero está completo: se puede crear el proyecto. */
  readonly ready = computed(() => this.steps.every((s) => s.problem(this.data()) === null));

  patch(change: Partial<WizardData>): void {
    this.data.update((d) => ({ ...d, ...change }));
  }

  /** Con foto, la forma la decide la foto; sin foto, se parte de un rectángulo con medidas típicas. */
  chooseSource(source: RoomSource, photo: File | null = null): void {
    this.data.update((d) =>
      source === 'photo'
        ? { ...d, source, photo: photo ?? d.photo }
        : {
            ...d,
            source,
            photo: null,
            shape: d.shape === 'auto' ? 'rect' : d.shape,
            widthM: d.widthM ?? DEFAULT_ROOM.widthM,
            depthM: d.depthM ?? DEFAULT_ROOM.depthM,
            heightM: d.heightM ?? DEFAULT_ROOM.heightM,
          },
    );
  }

  /** Elegir una forma concreta pide medidas; se proponen las típicas y la muesca habitual. */
  chooseShape(shape: ShapeChoice): void {
    this.data.update((d) => {
      if (shape === 'auto') return { ...d, shape, notchWidthM: null, notchDepthM: null };
      const dims = { widthM: d.widthM ?? DEFAULT_ROOM.widthM, depthM: d.depthM ?? DEFAULT_ROOM.depthM, heightM: d.heightM ?? DEFAULT_ROOM.heightM };
      const notch = ROOM_TEMPLATES[shape].hasNotch ? ROOM_TEMPLATES[shape].defaultNotch(dims.widthM, dims.depthM) : null;
      return { ...d, shape, ...dims, notchWidthM: notch ? round2(notch.widthM) : null, notchDepthM: notch ? round2(notch.depthM) : null };
    });
  }

  toggleStyle(id: StyleId): void {
    this.data.update((d) => ({ ...d, styles: d.styles.includes(id) ? d.styles.filter((s) => s !== id) : [...d.styles, id] }));
  }

  /** Avanza si el paso actual está completo. */
  next(): boolean {
    if (this.problem() !== null || this.isLast()) return false;
    this.index.update((i) => i + 1);
    return true;
  }

  back(): void {
    this.index.update((i) => Math.max(0, i - 1));
  }

  /** Se puede volver a un paso anterior, o saltar a uno posterior si los de antes están completos. */
  goTo(index: number): void {
    if (index < 0 || index >= this.steps.length) return;
    if (this.steps.slice(0, index).every((s) => s.problem(this.data()) === null)) this.index.set(index);
  }

  /** Lo que se envía al crear el proyecto; null mientras falte algo. */
  request(): NewProjectRequest | null {
    if (!this.ready()) return null;
    const d = this.data();
    const base = { photo: d.source === 'photo' ? d.photo : null, name: d.name.trim(), roomType: d.roomType, styles: d.styles };
    const { spec } = this.room();
    if (spec) return { ...base, roomSpec: spec };
    const complete = d.widthM !== null && d.depthM !== null && d.heightM !== null;
    return complete ? { ...base, room: { widthM: d.widthM!, depthM: d.depthM!, heightM: d.heightM! } } : base;
  }
}
