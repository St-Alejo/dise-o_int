import { Injectable, inject } from '@angular/core';
import type { JobProgressEvent } from '@interiores/shared-types';
import { Observable } from 'rxjs';
import { io, type Socket } from 'socket.io-client';
import { AuthService } from '../auth/auth.service';
import { ProjectsApi } from '../api/projects.api';

/**
 * Progreso en vivo de los jobs de IA.
 * WebSocket (socket.io, solo transporte websocket) con historial al suscribirse; si el socket
 * no conecta en 4 s o se cae, degrada a polling REST cada 2 s. El usuario ve progreso igual.
 */
@Injectable({ providedIn: 'root' })
export class ProgressService {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ProjectsApi);
  private socket: Socket | null = null;

  watch(projectId: string): Observable<JobProgressEvent> {
    return new Observable<JobProgressEvent>((subscriber) => {
      const seen = new Set<string>();
      const emit = (e: JobProgressEvent) => {
        const key = `${e.jobId}|${e.stage}|${e.pct}|${e.status}|${e.at}`;
        if (seen.has(key)) return;
        seen.add(key);
        subscriber.next(e);
      };
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      const startPolling = () => {
        if (pollTimer) return;
        const tick = () => this.api.progress(projectId).then((events) => events.forEach(emit)).catch(() => undefined);
        void tick();
        pollTimer = setInterval(tick, 2000);
      };
      const fallback = setTimeout(startPolling, 4000);

      const onProgress = (e: JobProgressEvent) => e.projectId === projectId && emit(e);
      let socket: Socket | null = null;
      void this.connect().then((s) => {
        if (subscriber.closed || !s) return;
        socket = s;
        s.on('progress', onProgress);
        const subscribe = () =>
          s.emit('subscribe', { projectId }, (ack: { ok: boolean; history?: JobProgressEvent[] }) => {
            if (!ack?.ok) return startPolling();
            clearTimeout(fallback);
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
            ack.history?.forEach(emit);
          });
        if (s.connected) subscribe();
        s.on('connect', subscribe);
        s.on('disconnect', startPolling);
      });

      return () => {
        clearTimeout(fallback);
        if (pollTimer) clearInterval(pollTimer);
        socket?.off('progress', onProgress);
        socket?.emit('unsubscribe', { projectId });
      };
    });
  }

  private async connect(): Promise<Socket | null> {
    if (this.socket) return this.socket;
    const token = await this.auth.validToken();
    if (!token) return null;
    this.socket = io({
      path: '/api/ws',
      transports: ['websocket'],
      // Función: en cada reconexión se usa un token fresco.
      auth: (cb) => void this.auth.validToken().then((t) => cb({ token: t })),
      reconnectionDelayMax: 10_000,
    });
    return this.socket;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
