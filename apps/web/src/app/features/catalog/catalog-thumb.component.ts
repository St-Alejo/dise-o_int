import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, signal } from '@angular/core';
import type { CatalogItem } from '@interiores/shared-types';
import { CATEGORY_ICONS } from './catalog-labels';
import { IconComponent } from '../../shared/ui/icon.component';
import { ThumbnailService } from './thumbnail.service';

/** Miniatura perezosa: se pide solo cuando la tarjeta entra en pantalla; mientras, un ícono. */
@Component({
  selector: 'app-catalog-thumb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (src(); as url) {
      <img [src]="url" alt="" width="48" height="48" decoding="async" />
    } @else {
      <app-icon class="icon" [name]="icons[item().category]" />
    }
  `,
  styles: `
    :host {
      width: 48px;
      height: 48px;
      flex: none;
      display: grid;
      place-items: center;
      border-radius: 8px;
      background: var(--surface-2);
      overflow: hidden;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .icon {
      font-size: 1.4rem;
    }
  `,
})
export class CatalogThumbComponent {
  readonly item = input.required<CatalogItem>();
  protected readonly src = signal<string | null>(null);
  protected readonly icons = CATEGORY_ICONS;
  private readonly thumbs = inject(ThumbnailService);

  constructor() {
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const load = () => void this.thumbs.get(this.item()).then((url) => this.src.set(url));
      if (typeof IntersectionObserver === 'undefined') return load();
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          load();
        }
      });
      io.observe(host);
      destroyRef.onDestroy(() => io.disconnect());
    });
  }
}
