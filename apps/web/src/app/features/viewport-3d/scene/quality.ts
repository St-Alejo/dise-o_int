export type QualityLevel = 'high' | 'medium' | 'low';
/** Lo que elige la persona: un nivel fijo o que el visor decida según el equipo. */
export type QualityChoice = QualityLevel | 'auto';

export interface QualitySettings {
  /** Tope de píxeles por punto de pantalla. */
  maxPixelRatio: number;
  /** Posprocesado (contorno de selección); sin él se pinta directo. */
  postFx: boolean;
  /** Oclusión ambiental, lo más caro del posprocesado. */
  ao: boolean;
  /** Lado del mapa de sombras del sol. */
  shadowMap: number;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  high: { maxPixelRatio: 2, postFx: true, ao: true, shadowMap: 2048 },
  medium: { maxPixelRatio: 1.25, postFx: true, ao: false, shadowMap: 1024 },
  low: { maxPixelRatio: 1, postFx: false, ao: false, shadowMap: 1024 },
};

export const QUALITY_CHOICES: readonly { id: QualityChoice; label: string }[] = [
  { id: 'auto', label: 'Calidad automática' },
  { id: 'high', label: 'Calidad alta' },
  { id: 'medium', label: 'Calidad media' },
  { id: 'low', label: 'Calidad baja' },
];

const ORDER: readonly QualityLevel[] = ['high', 'medium', 'low'];
const STORAGE_KEY = 'interiores.visor.calidad';

/** Un cuadro tarda demasiado a partir de aquí (unos 22 por segundo). */
export const SLOW_FRAME_MS = 45;
/** Cuadros seguidos que se miran antes de decidir: uno lento suelto no cuenta. */
export const SAMPLE_FRAMES = 10;

/**
 * Baja la calidad cuando el equipo no da: mira cuánto tardan los cuadros que se dibujan seguidos
 * y, si lo normal es que se pasen, cae un escalón. Nunca sube sola: subir y bajar a cada rato se nota más
 * que quedarse un escalón por debajo.
 */
export class QualityGovernor {
  private samples: number[] = [];

  constructor(
    private current: QualityLevel,
    private readonly adaptive: boolean,
  ) {}

  get level(): QualityLevel {
    return this.current;
  }

  /** Olvida lo medido (la cámara paró, cambió el tamaño…). */
  reset(): void {
    this.samples = [];
  }

  /** Anota lo que tardó un cuadro; devuelve el nivel nuevo si toca bajar, o null. */
  sample(frameMs: number): QualityLevel | null {
    if (!this.adaptive || this.current === 'low') return null;
    this.samples.push(frameMs);
    if (this.samples.length < SAMPLE_FRAMES) return null;
    // La mediana, no la media: un tirón aislado (cargar un modelo) no es un equipo lento.
    const median = [...this.samples].sort((a, b) => a - b)[Math.floor(this.samples.length / 2)]!;
    this.samples = [];
    if (median <= SLOW_FRAME_MS) return null;
    this.current = ORDER[ORDER.indexOf(this.current) + 1]!;
    return this.current;
  }
}

/**
 * Con qué nivel se empieza. A mano, el elegido. En automático, por arriba, salvo que el navegador
 * esté dibujando por software (sin GPU): ahí el posprocesado tarda segundos por cuadro y no tiene
 * sentido esperar a medirlo para bajarlo.
 */
export function startingLevel(choice: QualityChoice, rendererName: string | null): QualityLevel {
  if (choice !== 'auto') return choice;
  return rendererName && /swiftshader|llvmpipe|softpipe|software|basic render/i.test(rendererName) ? 'low' : 'high';
}

export function loadQualityChoice(): QualityChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return QUALITY_CHOICES.some((c) => c.id === saved) ? (saved as QualityChoice) : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveQualityChoice(choice: QualityChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Sin almacenamiento (modo privado): la elección vale solo para esta visita.
  }
}
