import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { BlenderLights, PhotorealRequest, Render, RenderNodeStatus, RenderSpec, UpdateRenderRequest } from '@interiores/shared-types';
import { firstValueFrom } from 'rxjs';

/** Galería del estudio de render: renders, fotos realistas y vídeos de un proyecto. */
@Injectable({ providedIn: 'root' })
export class RendersApi {
  private readonly http = inject(HttpClient);
  private readonly base = (projectId: string) => `/api/projects/${projectId}/renders`;

  list(projectId: string): Promise<Render[]> {
    return firstValueFrom(this.http.get<Render[]>(this.base(projectId)));
  }

  /** Sube un render hecho en el navegador (imagen del estudio o vídeo del recorrido). */
  upload(projectId: string, kind: 'path' | 'video', spec: RenderSpec, file: Blob): Promise<Render> {
    const form = new FormData();
    form.append('kind', kind);
    form.append('spec', JSON.stringify(spec));
    const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.startsWith('video/') ? file.type.slice(6) : 'png';
    form.append('file', file, `render.${ext}`);
    return firstValueFrom(this.http.post<Render>(this.base(projectId), form));
  }

  /** Manda la escena al nodo Blender; vuelve enseguida con el render pendiente (el avance llega por el socket). */
  renderInBlender(projectId: string, spec: RenderSpec, lights: BlenderLights, scene: Blob): Promise<Render> {
    const form = new FormData();
    form.append('spec', JSON.stringify(spec));
    form.append('lights', JSON.stringify(lights));
    form.append('file', scene, 'escena.glb');
    return firstValueFrom(this.http.post<Render>(`${this.base(projectId)}/blender`, form));
  }

  /** ¿Está encendido el nodo Blender? Si la consulta falla, se da por apagado. */
  renderNode(): Promise<RenderNodeStatus> {
    return firstValueFrom(this.http.get<RenderNodeStatus>('/api/render-node')).catch(() => ({ available: false, device: null }));
  }

  update(projectId: string, renderId: string, patch: UpdateRenderRequest): Promise<Render> {
    return firstValueFrom(this.http.patch<Render>(`${this.base(projectId)}/${renderId}`, patch));
  }

  remove(projectId: string, renderId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base(projectId)}/${renderId}`));
  }

  /** Pide la foto realista de un render; vuelve enseguida con el render pendiente. */
  photoreal(projectId: string, renderId: string, body: PhotorealRequest, depth: Blob | null): Promise<Render> {
    const form = new FormData();
    form.append('fidelity', body.fidelity ?? 'balanced');
    if (depth) form.append('depth', depth, 'depth.png');
    return firstValueFrom(this.http.post<Render>(`${this.base(projectId)}/${renderId}/photoreal`, form));
  }
}
