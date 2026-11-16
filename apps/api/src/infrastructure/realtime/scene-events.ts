import { Injectable, Logger } from '@nestjs/common';
import type { ISceneEvents } from '../../ports/index.js';

/** Avisos de «escena guardada» dentro del proceso: quien escucha no frena a quien guarda. */
@Injectable()
export class InProcessSceneEvents implements ISceneEvents {
  private readonly logger = new Logger(InProcessSceneEvents.name);
  private readonly handlers = new Set<(projectId: string) => void>();

  emit(projectId: string): void {
    for (const handler of this.handlers) {
      queueMicrotask(() => {
        try {
          handler(projectId);
        } catch (err) {
          this.logger.warn({ err, projectId }, 'Un oyente de escena falló');
        }
      });
    }
  }

  on(handler: (projectId: string) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
