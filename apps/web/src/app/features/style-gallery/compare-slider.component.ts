import { ChangeDetectionStrategy, Component, ElementRef, input, model, viewChild } from '@angular/core';

/**
 * Comparador "antes / después" con divisor arrastrable (patrón estándar para entender
 * qué cambió de un vistazo). Accesible: es un slider con teclado (flechas, Inicio, Fin).
 */
@Component({
  selector: 'app-compare-slider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #frame
      class="frame"
      (pointerdown)="start($event)"
      (pointermove)="move($event)"
      (pointerup)="end($event)"
      (pointercancel)="end($event)"
    >
      <img class="after" [src]="after()" [alt]="afterLabel()" draggable="false" />
      <div class="before" [style.clip-path]="'inset(0 ' + (100 - position()) + '% 0 0)'">
        <img [src]="before()" alt="Foto original" draggable="false" />
      </div>
      <span class="tag tag-l" aria-hidden="true">Antes</span>
      <span class="tag tag-r" aria-hidden="true">{{ afterLabel() }}</span>
      <div
        class="handle"
        [style.left.%]="position()"
        role="slider"
        tabindex="0"
        aria-label="Comparar antes y después"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-valuenow]="position()"
        [attr.aria-valuetext]="position() + '% foto original'"
        (keydown)="key($event)"
      >
        <span class="grip" aria-hidden="true">⇆</span>
      </div>
    </div>
  `,
  styles: `
    .frame {
      position: relative;
      overflow: hidden;
      border-radius: var(--radius);
      background: #111;
      touch-action: pan-y;
      user-select: none;
      cursor: ew-resize;
      aspect-ratio: 4 / 3;
    }
    img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .before {
      position: absolute;
      inset: 0;
    }
    .handle {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 3px;
      margin-left: -1.5px;
      background: #fff;
      box-shadow: 0 0 8px rgb(0 0 0 / 50%);
    }
    .grip {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: #fff;
      color: #333;
      display: grid;
      place-items: center;
      font-weight: 700;
      box-shadow: var(--shadow);
    }
    .tag {
      position: absolute;
      top: 10px;
      padding: 3px 10px;
      border-radius: 99px;
      background: rgb(0 0 0 / 55%);
      color: #fff;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .tag-l {
      left: 10px;
    }
    .tag-r {
      right: 10px;
    }
  `,
})
export class CompareSliderComponent {
  readonly before = input.required<string>();
  readonly after = input.required<string>();
  readonly afterLabel = input('Después');
  readonly position = model(50);

  private readonly frame = viewChild.required<ElementRef<HTMLDivElement>>('frame');
  private dragging = false;

  start(e: PointerEvent): void {
    this.dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.update(e);
  }

  move(e: PointerEvent): void {
    if (this.dragging) this.update(e);
  }

  end(e: PointerEvent): void {
    this.dragging = false;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }

  key(e: KeyboardEvent): void {
    const map: Record<string, number> = {
      ArrowLeft: this.position() - 5,
      ArrowRight: this.position() + 5,
      Home: 0,
      End: 100,
    };
    if (e.key in map) {
      e.preventDefault();
      this.position.set(Math.min(100, Math.max(0, map[e.key]!)));
    }
  }

  private update(e: PointerEvent): void {
    const rect = this.frame().nativeElement.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    this.position.set(Math.round(Math.min(100, Math.max(0, pct))));
  }
}
