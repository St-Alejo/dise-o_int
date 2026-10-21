import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FINISH_PATTERNS, customFinishId, type FinishSpec } from '@interiores/shared-types';
import { pinSurface } from '../brief/brief-model';
import { DesignProjectStore } from '../project/design-project.store';
import { SetFinishesCommand } from '../viewport-3d/commands';
import { drawPattern } from '../viewport-3d/scene/pattern-textures';
import { effectiveFinishes, type WallTarget } from './finishes-model';
import { KIND_LABELS, PATTERN_LABELS, SURFACE_LABELS, applySpec, buildSpec, defaultName, kindsFor, type SpecSurface } from './finish-spec-model';

const SURFACES: SpecSurface[] = ['floor', 'walls', 'ceiling', 'wallTiles'];

/**
 * Acabado a medida: tipo, uno a tres colores, dibujo, brillo y tamaño de pieza, con muestra en
 * vivo. Al aplicarlo es un comando deshacible y, si se marca, queda fijado para Recomendar.
 */
@Component({
  selector: 'app-finish-spec-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="editor" [open]="opened()" (toggle)="opened.set($any($event.target).open)">
      <summary>Acabado a medida</summary>
      <div class="grid">
        <div class="preview" role="img" [attr.aria-label]="'Muestra: ' + name()" [style.background-image]="preview()"></div>
        <div class="fields">
          <label class="field">
            <span>Dónde</span>
            <select class="input select" [value]="surface()" (change)="setSurface($any($event.target).value)">
              @for (s of surfaces; track s) {
                <option [value]="s">{{ surfaceLabels[s] }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span>Tipo</span>
            <select class="input select" [value]="kind()" (change)="kind.set($any($event.target).value)">
              @for (k of kinds(); track k) {
                <option [value]="k">{{ kindLabels[k] }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span>Dibujo</span>
            <select class="input select" [value]="pattern()" (change)="pattern.set($any($event.target).value)">
              @for (p of patterns; track p) {
                <option [value]="p">{{ patternLabels[p] }}</option>
              }
            </select>
          </label>
        </div>
      </div>

      <fieldset class="colors">
        <legend>Colores</legend>
        @for (c of colors(); track $index; let i = $index) {
          <span class="color">
            <input type="color" [value]="c" (input)="setColor(i, $any($event.target).value)" [attr.aria-label]="'Color ' + (i + 1)" />
            @if (colors().length > 1) {
              <button type="button" class="icon-btn sm" (click)="removeColor(i)" [attr.aria-label]="'Quitar color ' + (i + 1)">×</button>
            }
          </span>
        }
        @if (colors().length < 3) {
          <button type="button" class="btn btn-sm btn-ghost" (click)="addColor()">+ Color</button>
        }
      </fieldset>

      <div class="fields">
        <label class="field grow">
          <span>Brillo: {{ glossLabel() }}</span>
          <input type="range" min="0" max="1" step="0.05" [value]="gloss()" (input)="gloss.set(+$any($event.target).value)" />
        </label>
        @if (pattern() !== 'plain') {
          <label class="field">
            <span>Pieza (cm)</span>
            <input class="input num" type="number" min="2" max="200" [value]="sizeCm()" (change)="sizeCm.set(+$any($event.target).value)" />
          </label>
        }
        @if (surface() === 'wallTiles') {
          <label class="field">
            <span>Alto (m)</span>
            <input class="input num" type="number" min="0.3" max="6" step="0.1" [value]="heightM()" (change)="heightM.set(+$any($event.target).value)" />
          </label>
        }
      </div>

      <label class="check"><input type="checkbox" [checked]="pin()" (change)="pin.set($any($event.target).checked)" /> Fijarlo para que Recomendar no lo cambie</label>
      <button type="button" class="btn btn-primary btn-sm" [disabled]="!spec() || !store.project()" (click)="apply()">Poner en {{ surfaceLabels[surface()].toLowerCase() }}</button>
    </details>
  `,
  styles: `
    .editor {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
    }
    summary {
      cursor: pointer;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .editor[open] {
      display: grid;
      gap: 10px;
    }
    .grid {
      display: grid;
      grid-template-columns: 84px 1fr;
      gap: 10px;
      margin-top: 8px;
    }
    .preview {
      width: 84px;
      height: 84px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background-size: cover;
    }
    .fields {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: end;
    }
    .field {
      display: grid;
      gap: 2px;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .grow {
      flex: 1 1 140px;
    }
    .select {
      min-height: 30px;
      padding: 2px 8px;
      font-size: 0.85rem;
    }
    .num {
      width: 80px;
      min-height: 30px;
      padding: 2px 8px;
    }
    .colors {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      border: 0;
      padding: 0;
      margin: 0;
    }
    legend {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .color {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }
    input[type='color'] {
      width: 36px;
      height: 30px;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: none;
    }
    .check {
      display: flex;
      gap: 6px;
      align-items: center;
      font-size: 0.85rem;
    }
  `,
})
export class FinishSpecEditorComponent {
  protected readonly store = inject(DesignProjectStore);
  /** Pared a la que va "Paredes" (la del selector de arriba). */
  readonly wallTarget = input<WallTarget>('all');

  protected readonly surfaces = SURFACES;
  protected readonly surfaceLabels = SURFACE_LABELS;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly patternLabels = PATTERN_LABELS;
  protected readonly patterns = FINISH_PATTERNS;

  protected readonly opened = signal(false);
  protected readonly surface = signal<SpecSurface>('floor');
  protected readonly kind = signal<FinishSpec['kind']>('tile');
  protected readonly pattern = signal<FinishSpec['pattern']>('grid');
  protected readonly colors = signal<string[]>(['#a9d4ee', '#9bd3b0']);
  protected readonly gloss = signal(0.6);
  protected readonly sizeCm = signal(30);
  protected readonly heightM = signal(1.2);
  protected readonly pin = signal(true);

  protected readonly kinds = computed(() => kindsFor(this.surface()));
  protected readonly name = computed(() => defaultName(this.kind(), this.pattern(), this.gloss()));
  protected readonly glossLabel = computed(() => (this.gloss() >= 0.7 ? 'brillante' : this.gloss() <= 0.15 ? 'mate' : 'satinado'));
  protected readonly spec = computed(() =>
    buildSpec({
      name: this.name(),
      kind: this.kind(),
      colors: this.colors(),
      pattern: this.pattern(),
      gloss: this.gloss(),
      ...(this.pattern() !== 'plain' ? { tileSizeM: Math.min(2, Math.max(0.02, this.sizeCm() / 100)) } : {}),
    }),
  );

  /** La misma textura que verá el 3D, como imagen; sin canvas, los colores en franjas. */
  protected readonly preview = computed(() => {
    const spec = this.spec();
    if (!spec) return 'none';
    const maps = drawPattern(customFinishId(spec), spec);
    if (maps) {
      const url = (maps.map.image as HTMLCanvasElement).toDataURL('image/png');
      maps.map.dispose();
      maps.normalMap.dispose();
      return `url(${url})`;
    }
    return `linear-gradient(135deg, ${spec.colors.join(', ')})`;
  });

  protected setSurface(surface: SpecSurface): void {
    this.surface.set(surface);
    const kinds = kindsFor(surface);
    if (!kinds.includes(this.kind())) this.kind.set(kinds[0]!);
  }

  protected setColor(i: number, hex: string): void {
    this.colors.update((list) => list.map((c, j) => (j === i ? hex.toLowerCase() : c)));
  }

  protected addColor(): void {
    this.colors.update((list) => [...list, list.at(-1) ?? '#ffffff'].slice(0, 3));
  }

  protected removeColor(i: number): void {
    this.colors.update((list) => list.filter((_, j) => j !== i));
  }

  protected apply(): void {
    const spec = this.spec();
    if (!spec) return;
    const before = this.store.finishes();
    const next = applySpec(effectiveFinishes(before, this.store.project()?.selectedStyleId ?? null), this.surface(), spec, {
      wall: this.wallTarget(),
      heightM: this.heightM(),
      roomHeightM: this.store.shell()?.heightM ?? 2.6,
    });
    this.store.execute(new SetFinishesCommand(before, next));
    // Fijar una sola pared no tiene candado propio: el Brief fija las paredes cuando son todas.
    const surface = this.surface();
    if (this.pin() && !(surface === 'walls' && this.wallTarget() !== 'all')) void this.store.setBrief(pinSurface(this.store.brief(), surface, next));
  }
}
