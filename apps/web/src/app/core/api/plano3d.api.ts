import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Una casa de Plano 3D enlazada por código (ADR-0039). */
export interface Plano3dLink {
  id: string;
  homeId: string;
  plano3dProjectId: string;
  projectName: string;
  rooms: { projectId: string; name: string; level: string }[];
  live: boolean;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class Plano3dApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/plano3d/links';

  list(): Promise<Plano3dLink[]> {
    return firstValueFrom(this.http.get<Plano3dLink[]>(this.base));
  }
  link(code: string): Promise<Plano3dLink> {
    return firstValueFrom(this.http.post<Plano3dLink>(this.base, { code }));
  }
  sync(id: string): Promise<Plano3dLink> {
    return firstValueFrom(this.http.post<Plano3dLink>(`${this.base}/${id}/sync`, {}));
  }
  unlink(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/${id}`));
  }
}
