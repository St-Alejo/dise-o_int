import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Plano3dModel } from '@interiores/shared-types';
import { DependencyError, NotFoundError, UnauthorizedError, ValidationError } from '../../common/errors.js';
import type { AppConfig } from '../../config/env.js';
import { APP_CONFIG, type IPlano3dClient, type Plano3dGrant, type Plano3dLiveMessage, type Plano3dLiveRoom } from '../../ports/index.js';

const TIMEOUT_MS = 15_000;

/**
 * Cliente de la API de Plano 3D (ADR-024 allá, ADR-0039 aquí): canje del código, lectura del
 * proyecto con el token de enlace y la sala en vivo por WebSocket (el `WebSocket` nativo de Node).
 */
@Injectable()
export class Plano3dHttpClient implements IPlano3dClient {
  private readonly base: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.base = config.PLANO3D_API_URL.replace(/\/+$/, '');
  }

  async claim(code: string): Promise<Plano3dGrant> {
    const res = await this.request('/api/shares/claim', { method: 'POST', body: JSON.stringify({ code }), headers: { 'content-type': 'application/json' } });
    if (res.status === 404) throw new NotFoundError('Ese código no existe o ya se revocó en Plano 3D');
    if (res.status === 422) throw new ValidationError('El código tiene 8 letras o números, como K7QM-3XTP');
    if (res.status === 429) throw new ValidationError('Demasiados intentos: espera un minuto y vuelve a probar');
    await this.ensureOk(res);
    const body = (await res.json()) as { token: string; expires_in: number; project_id: string; project_name: string };
    return { token: body.token, expiresIn: body.expires_in, projectId: body.project_id, projectName: body.project_name };
  }

  async project(token: string): Promise<{ id: string; name: string; model: Plano3dModel | null }> {
    const res = await this.request('/api/shares/project', { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 401 || res.status === 403 || res.status === 404) throw new UnauthorizedError('Plano 3D ya no comparte esta casa');
    await this.ensureOk(res);
    const body = (await res.json()) as { id: string; name: string; model: Plano3dModel | null };
    return { id: body.id, name: body.name, model: body.model };
  }

  connect(
    projectId: string,
    token: string,
    opts: { lastSeq: number | null; name: string; onMessage: (msg: Plano3dLiveMessage) => void; onClose: (code: number, reason: string) => void },
  ): Plano3dLiveRoom {
    const url = `${this.base.replace(/^http/, 'ws')}/api/ws/collab/${encodeURIComponent(projectId)}?link=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    const queue: string[] = [];
    const sendRaw = (msg: unknown) => {
      const text = JSON.stringify(msg);
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
      else if (ws.readyState === WebSocket.CONNECTING) queue.push(text);
    };
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'hello', client: 'interiores', name: opts.name, last_seq: opts.lastSeq }));
      for (const text of queue.splice(0)) ws.send(text);
    });
    ws.addEventListener('message', (ev) => {
      try {
        opts.onMessage(JSON.parse(String(ev.data)) as Plano3dLiveMessage);
      } catch {
        /* un mensaje roto no tumba la sala */
      }
    });
    ws.addEventListener('close', (ev) => opts.onClose(ev.code, ev.reason));
    ws.addEventListener('error', () => undefined);
    const ping = setInterval(() => sendRaw({ type: 'ping' }), 25_000);
    ws.addEventListener('close', () => clearInterval(ping));
    return {
      send: (ops) => {
        const opId = `int-${randomUUID()}`;
        sendRaw({ type: 'ops', op_id: opId, ops });
        return opId;
      },
      presence: (state) => sendRaw({ type: 'presence', state }),
      close: () => {
        clearInterval(ping);
        ws.close(1000, 'bye');
      },
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.base}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new DependencyError('No se pudo hablar con Plano 3D: revisa que esté encendido');
    }
  }

  private async ensureOk(res: Response): Promise<void> {
    if (!res.ok) throw new DependencyError(`Plano 3D respondió ${res.status}`);
  }
}
