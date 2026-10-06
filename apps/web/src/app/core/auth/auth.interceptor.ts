import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

const isAuthEndpoint = (req: HttpRequest<unknown>) => req.url.startsWith('/api/auth/') && !req.url.endsWith('/me');

/**
 * Adjunta el access token y, ante un 401, intenta UN refresh silencioso y reintenta.
 * Si el refresh falla, la sesión expiró: se redirige al login conservando la ruta.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  if (!req.url.startsWith('/api/') || isAuthEndpoint(req)) return next(req);

  const withToken = (token: string | null) =>
    token ? req.clone({ setHeaders: { authorization: `Bearer ${token}` } }) : req;

  return next(withToken(auth.accessToken)).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || !auth.accessToken) return throwError(() => err);
      return from(auth.refresh()).pipe(
        switchMap((token) => {
          if (!token) {
            auth.sessionExpired();
            return throwError(() => err);
          }
          return next(withToken(token));
        }),
      );
    }),
  );
};
