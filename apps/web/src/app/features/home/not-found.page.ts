import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="container" style="padding: 64px 0; text-align: center">
      <h1>Esta página no existe</h1>
      <p class="muted">Puede que el enlace esté mal escrito o que el proyecto se haya borrado.</p>
      <a routerLink="/" class="btn btn-primary">Ir al inicio</a>
    </section>
  `,
})
export class NotFoundPage {}
