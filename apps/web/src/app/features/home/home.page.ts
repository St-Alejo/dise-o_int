import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { STYLES } from '@interiores/shared-types';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="hero">
      <div class="container hero-grid">
        <div>
          <p class="eyebrow">Diseño de interiores con IA</p>
          <h1>Tu cuarto, rediseñado en 2D y editable en 3D.</h1>
          <p class="lead muted">
            Sube una foto y compara varias propuestas de estilo al instante. Luego entra a una
            escena 3D con muebles reales a escala: muévelos, cámbialos, míralos en tu cuarto con
            realidad aumentada y llévate la lista de compras.
          </p>
          <div class="row">
            <a class="btn btn-primary btn-lg" [routerLink]="auth.isAuthenticated() ? '/proyectos/nuevo' : '/registro'">Rediseñar mi cuarto</a>
            @if (!auth.isAuthenticated()) {
              <a class="btn btn-lg" routerLink="/entrar">Ya tengo cuenta</a>
            }
          </div>
        </div>
        <ol class="steps" aria-label="Cómo funciona">
          <li><span class="n">1</span><div><strong>Sube una foto</strong><p class="muted">De frente, con buena luz, mostrando el cuarto completo.</p></div></li>
          <li><span class="n">2</span><div><strong>Compara estilos</strong><p class="muted">Varias propuestas con un control de "antes / después" y de intensidad.</p></div></li>
          <li><span class="n">3</span><div><strong>Edita en 3D</strong><p class="muted">Muebles reales con medidas y precio; deshacer ilimitado.</p></div></li>
          <li><span class="n">4</span><div><strong>Compártelo</strong><p class="muted">Link de solo lectura, versión guardada y lista de compras en PDF.</p></div></li>
        </ol>
      </div>
    </section>

    <section class="container styles">
      <h2>Estilos disponibles</h2>
      <div class="style-grid">
        @for (s of styles; track s.id) {
          <article class="card style-card">
            <div class="swatches" aria-hidden="true">
              @for (c of s.palette; track c) {
                <span [style.background]="c"></span>
              }
            </div>
            <h3>{{ s.label }}</h3>
            <p class="muted">{{ s.description }}</p>
          </article>
        }
      </div>
    </section>

    <section class="container privacy card">
      <h2>Tu casa es privada</h2>
      <ul>
        <li>Eliminamos los metadatos de ubicación (GPS) de tus fotos al subirlas.</li>
        <li>Si no guardas ni compartes un proyecto, se borra por completo a las 24 horas.</li>
        <li>Borrar un proyecto elimina de verdad la foto y los renders, no solo lo oculta.</li>
        <li>Nunca usamos tus fotos para entrenar modelos.</li>
      </ul>
    </section>
  `,
  styles: `
    .hero {
      padding: clamp(32px, 6vw, 80px) 0;
      background: radial-gradient(circle at 80% 10%, var(--primary-soft), transparent 55%);
    }
    .hero-grid {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 48px;
      align-items: center;
    }
    .eyebrow {
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--primary);
    }
    .lead {
      font-size: 1.15rem;
      max-width: 56ch;
      margin-bottom: 24px;
    }
    .steps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 12px;
    }
    .steps li {
      display: flex;
      gap: 14px;
      padding: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-sm);
    }
    .steps p {
      margin: 2px 0 0;
      font-size: 0.92rem;
    }
    .n {
      flex: none;
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--primary);
      color: var(--on-primary);
      font-weight: 700;
    }
    .styles {
      padding: 32px 0;
    }
    .style-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 16px;
    }
    .style-card h3 {
      margin-top: 12px;
    }
    .swatches {
      display: flex;
      height: 44px;
      border-radius: 10px;
      overflow: hidden;
    }
    .swatches span {
      flex: 1;
    }
    .privacy {
      margin-bottom: 48px;
    }
    .privacy ul {
      margin: 0;
      padding-left: 20px;
      display: grid;
      gap: 6px;
    }
    @media (max-width: 860px) {
      .hero-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthService);
  protected readonly styles = Object.values(STYLES);
}
