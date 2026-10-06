import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { JobProgressEvent } from '@interiores/shared-types';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { PROGRESS_BROKER, PROJECT_REPOSITORY, type IProgressBroker, type IProjectRepository } from '../../ports/index.js';
import type { AuthPrincipal } from '../auth/auth.decorators.js';
import { TokenService } from '../auth/token.service.js';

const SubscribeSchema = z.object({ projectId: z.string().uuid() });
const room = (projectId: string) => `project:${projectId}`;

/**
 * Progreso en vivo de los jobs (paso 2 del flujo). Solo transporte WebSocket (sin long-polling)
 * para no necesitar sticky sessions al escalar la API. Autenticación con el access token en
 * el handshake; cada suscripción verifica que el proyecto sea del usuario.
 */
@WebSocketGateway({ path: '/api/ws', transports: ['websocket'], serveClient: false, cors: false })
export class ProgressGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProgressGateway.name);
  private unsubscribe: (() => Promise<void>) | null = null;

  @WebSocketServer() private server!: Server;

  constructor(
    private readonly tokens: TokenService,
    @Inject(PROGRESS_BROKER) private readonly broker: IProgressBroker,
    @Inject(PROJECT_REPOSITORY) private readonly projects: IProjectRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.unsubscribe = await this.broker.subscribe((event) => this.forward(event));
  }

  async onModuleDestroy(): Promise<void> {
    await this.unsubscribe?.();
  }

  handleConnection(client: Socket): void {
    try {
      const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string') throw new Error('sin token');
      client.data.user = this.tokens.verifyAccess(token);
    } catch {
      client.emit('error-message', { code: 'unauthorized', message: 'Sesión inválida' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<{ ok: boolean; history?: JobProgressEvent[] }> {
    const parsed = SubscribeSchema.safeParse(body);
    const user = client.data.user as AuthPrincipal | undefined;
    if (!parsed.success || !user) return { ok: false };
    const project = await this.projects.findById(parsed.data.projectId);
    if (!project || project.ownerId !== user.userId) return { ok: false };

    await client.join(room(project.id));
    // Primero el historial (quien llega tarde no se pierde etapas), luego eventos en vivo.
    return { ok: true, history: await this.broker.history(project.id) };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribeRoom(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<{ ok: boolean }> {
    const parsed = SubscribeSchema.safeParse(body);
    if (parsed.success) await client.leave(room(parsed.data.projectId));
    return { ok: true };
  }

  private forward(event: JobProgressEvent): void {
    this.server?.to(room(event.projectId)).emit('progress', event);
  }
}
