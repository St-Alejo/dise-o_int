import { HttpClient, HttpEvent, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AutoLayoutRequest,
  CalibrateRequest,
  CatalogItem,
  CatalogQuery,
  DesignProject,
  GenerateStylesRequest,
  JobAccepted,
  JobProgressEvent,
  ProjectListItem,
  PublicProject,
  RoomType,
  ShareLink,
  ShoppingList,
  StyleId,
  UpdateSceneRequest,
} from '@interiores/shared-types';
import { Observable, filter, firstValueFrom, map, shareReplay } from 'rxjs';

export type UploadEvent = { kind: 'progress'; pct: number } | { kind: 'done'; project: DesignProject };

/** Cliente tipado de la API REST (los tipos vienen de @interiores/shared-types). */
@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/projects';

  list(): Promise<ProjectListItem[]> {
    return firstValueFrom(this.http.get<ProjectListItem[]>(this.base));
  }

  get(id: string): Promise<DesignProject> {
    return firstValueFrom(this.http.get<DesignProject>(`${this.base}/${id}`));
  }

  /** Sube la foto reportando progreso real de la subida. */
  create(photo: File, name: string, roomType: RoomType, styles: StyleId[]): Observable<UploadEvent> {
    const form = new FormData();
    form.append('name', name);
    form.append('roomType', roomType);
    form.append('styles', styles.join(','));
    form.append('photo', photo, photo.name);
    return this.http.post<DesignProject>(this.base, form, { reportProgress: true, observe: 'events' }).pipe(
      filter((e: HttpEvent<DesignProject>) => e.type === HttpEventType.UploadProgress || e.type === HttpEventType.Response),
      map((e): UploadEvent =>
        e.type === HttpEventType.UploadProgress
          ? { kind: 'progress', pct: e.total ? Math.round((e.loaded / e.total) * 100) : 0 }
          : { kind: 'done', project: (e as { body: DesignProject }).body },
      ),
    );
  }

  retry(id: string): Promise<DesignProject> {
    return firstValueFrom(this.http.post<DesignProject>(`${this.base}/${id}/retry`, {}));
  }

  rename(id: string, name: string): Promise<DesignProject> {
    return firstValueFrom(this.http.patch<DesignProject>(`${this.base}/${id}`, { name }));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/${id}`));
  }

  progress(id: string): Promise<JobProgressEvent[]> {
    return firstValueFrom(this.http.get<JobProgressEvent[]>(`${this.base}/${id}/progress`));
  }

  saveScene(id: string, body: UpdateSceneRequest): Promise<DesignProject> {
    return firstValueFrom(this.http.put<DesignProject>(`${this.base}/${id}/scene`, body));
  }

  calibrate(id: string, body: CalibrateRequest): Promise<DesignProject> {
    return firstValueFrom(this.http.post<DesignProject>(`${this.base}/${id}/calibrate`, body));
  }

  selectStyle(id: string, styleId: StyleId | null): Promise<DesignProject> {
    return firstValueFrom(this.http.put<DesignProject>(`${this.base}/${id}/selected-style`, { styleId }));
  }

  generateStyles(id: string, body: GenerateStylesRequest): Promise<JobAccepted> {
    return firstValueFrom(this.http.post<JobAccepted>(`${this.base}/${id}/styles`, body));
  }

  autoLayout(id: string, body: AutoLayoutRequest): Promise<JobAccepted> {
    return firstValueFrom(this.http.post<JobAccepted>(`${this.base}/${id}/layout`, body));
  }

  saveVersion(id: string, note?: string): Promise<DesignProject> {
    return firstValueFrom(this.http.post<DesignProject>(`${this.base}/${id}/versions`, { note }));
  }

  restoreVersion(id: string, versionId: string): Promise<DesignProject> {
    return firstValueFrom(this.http.post<DesignProject>(`${this.base}/${id}/versions/${versionId}/restore`, {}));
  }

  share(id: string): Promise<ShareLink> {
    return firstValueFrom(this.http.post<ShareLink>(`${this.base}/${id}/share`, {}));
  }

  unshare(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/${id}/share`));
  }

  shoppingList(id: string): Promise<ShoppingList> {
    return firstValueFrom(this.http.get<ShoppingList>(`${this.base}/${id}/shopping-list`));
  }

  shoppingListPdf(id: string): Promise<Blob> {
    return firstValueFrom(this.http.get(`${this.base}/${id}/shopping-list.pdf`, { responseType: 'blob' }));
  }

  publicProject(token: string): Promise<PublicProject> {
    return firstValueFrom(this.http.get<PublicProject>(`/api/public/${encodeURIComponent(token)}`));
  }

  publicShoppingList(token: string): Promise<ShoppingList> {
    return firstValueFrom(this.http.get<ShoppingList>(`/api/public/${encodeURIComponent(token)}/shopping-list`));
  }
}

/** Catálogo con caché en memoria (es público y cambia poco). */
@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly http = inject(HttpClient);
  private all$?: Observable<CatalogItem[]>;

  all(): Promise<CatalogItem[]> {
    this.all$ ??= this.http.get<CatalogItem[]>('/api/catalog').pipe(shareReplay({ bufferSize: 1, refCount: false }));
    return firstValueFrom(this.all$);
  }

  search(query: CatalogQuery): Promise<CatalogItem[]> {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) if (v) params[k] = String(v);
    return firstValueFrom(this.http.get<CatalogItem[]>('/api/catalog', { params }));
  }
}
