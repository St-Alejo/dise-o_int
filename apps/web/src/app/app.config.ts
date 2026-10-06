import {
  ApplicationConfig,
  ErrorHandler,
  Injectable,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { ToastService } from './core/ui/toast.service';

/** Errores no capturados: se registran y se avisa al usuario sin romper la app. */
@Injectable()
class AppErrorHandler implements ErrorHandler {
  private readonly toast = inject(ToastService);

  handleError(error: unknown): void {
    console.error(error);
    const msg = error instanceof Error ? error.message : String(error);
    if (/ChunkLoadError|Failed to fetch dynamically imported module/.test(msg)) {
      this.toast.error('Hay una versión nueva de la app. Recarga la página.');
      return;
    }
    this.toast.error('Algo salió mal. Si persiste, recarga la página.');
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    { provide: ErrorHandler, useClass: AppErrorHandler },
    // Recupera la sesión (refresh silencioso con la cookie httpOnly) antes del primer render.
    provideAppInitializer(() => inject(AuthService).restoreSession()),
  ],
};
