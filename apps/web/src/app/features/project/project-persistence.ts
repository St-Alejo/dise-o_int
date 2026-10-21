import { Injectable, inject } from '@angular/core';
import type { DesignBrief, DesignProject, StyleId, UpdateRoomRequest, UpdateSceneRequest } from '@interiores/shared-types';
import { ProjectsApi } from '../../core/api/projects.api';

/**
 * Dónde vive el proyecto que se está editando (patrón Strategy). El editor solo sabe leerlo y
 * guardarlo: con cuenta va a la API; en la demo sin registro, a este navegador.
 */
@Injectable({ providedIn: 'root', useFactory: () => inject(ApiPersistence) })
export abstract class ProjectPersistence {
  abstract get(id: string): Promise<DesignProject>;
  abstract saveScene(id: string, body: UpdateSceneRequest): Promise<DesignProject>;
  abstract updateRoom(id: string, body: UpdateRoomRequest): Promise<DesignProject>;
  abstract selectStyle(id: string, styleId: StyleId | null): Promise<DesignProject>;
  /** Tope de gasto del cuarto: no es parte de la escena y no cambia su revisión. */
  abstract setBudget(id: string, cap: number | null): Promise<DesignProject>;
  /** Brief de diseño (lo pedido y fijado): tampoco cambia la revisión. */
  abstract setBrief(id: string, brief: DesignBrief | null): Promise<DesignProject>;
}

@Injectable({ providedIn: 'root' })
export class ApiPersistence extends ProjectPersistence {
  private readonly api = inject(ProjectsApi);

  get(id: string): Promise<DesignProject> {
    return this.api.get(id);
  }
  saveScene(id: string, body: UpdateSceneRequest): Promise<DesignProject> {
    return this.api.saveScene(id, body);
  }
  updateRoom(id: string, body: UpdateRoomRequest): Promise<DesignProject> {
    return this.api.updateRoom(id, body);
  }
  selectStyle(id: string, styleId: StyleId | null): Promise<DesignProject> {
    return this.api.selectStyle(id, styleId);
  }
  setBudget(id: string, cap: number | null): Promise<DesignProject> {
    return this.api.setBudget(id, cap);
  }
  setBrief(id: string, brief: DesignBrief | null): Promise<DesignProject> {
    return this.api.setBrief(id, brief);
  }
}
