import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/** Calidad que pide el chat: borrador (rápido) o final (más limpio). */
export type ChatRenderQuality = 'borrador' | 'final';

/**
 * Pedidos de render que no salen del botón del estudio (p. ej. "renderiza la sala" en el chat).
 * Vive con el editor: el chat lo pide y el estudio de render lo atiende.
 */
@Injectable()
export class RenderRequestsService {
  private readonly requests = new Subject<ChatRenderQuality>();
  readonly requested$ = this.requests.asObservable();

  request(quality: ChatRenderQuality): void {
    this.requests.next(quality);
  }
}
