import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecommendResponse } from '@interiores/shared-types';
import { ProjectsApi } from '../../core/api/projects.api';
import { ToastService } from '../../core/ui/toast.service';
import { DesignProjectStore } from '../project/design-project.store';
import { RECOMMEND_LABEL, RecommendService } from './recommend.service';

const response = (over: Partial<RecommendResponse> = {}): RecommendResponse => ({
  recommendationId: 'r1',
  projectId: 'p1',
  jobId: null,
  styleId: 'moderno',
  seed: 1,
  palette: ['#ffffff', '#000000', '#888888', '#444444', '#222222'],
  summary: 'Moderno: piso roble, paredes blanco, luz neutra',
  revision: 3,
  ...over,
});

describe('RecommendService', () => {
  const undoLabel = signal<string | null>(null);
  const store = { project: signal({ id: 'p1' }), flush: vi.fn(async () => {}), reload: vi.fn(async () => {}), undo: vi.fn(), undoLabel };
  const api = { recommend: vi.fn(), recommendationFeedback: vi.fn(async () => {}) };
  let service: RecommendService;

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [RecommendService, { provide: DesignProjectStore, useValue: store }, { provide: ProjectsApi, useValue: api }, { provide: ToastService, useValue: { success: vi.fn(), show: vi.fn(), error: vi.fn() } }],
    });
    service = TestBed.inject(RecommendService);
  });

  it('con intensidad suave guarda primero y recarga la propuesta como un paso de deshacer', async () => {
    api.recommend.mockResolvedValue(response());
    await service.recommend('suave');
    expect(store.flush).toHaveBeenCalledBefore(api.recommend);
    expect(api.recommend).toHaveBeenCalledWith('p1', { intensity: 'suave' });
    expect(store.reload).toHaveBeenCalledWith(RECOMMEND_LABEL);
    expect(service.current()?.summary).toContain('Moderno');
  });

  it('con intensidad total espera la distribución: el job es suyo una sola vez', async () => {
    api.recommend.mockResolvedValue(response({ jobId: 'scene.p1.r3' }));
    await service.recommend('total');
    expect(store.reload).not.toHaveBeenCalled();
    expect(service.isPending()).toBe(true);
    expect(service.claimJob('otro')).toBeUndefined();
    expect(service.claimJob('scene.p1.r3')).toBe(RECOMMEND_LABEL);
    expect(service.claimJob('scene.p1.r3')).toBeUndefined();
    expect(service.isPending()).toBe(false);
  });

  it('los gestos llegan una vez; deshacer vuelve atrás la recomendación y cierra la tarjeta', async () => {
    api.recommend.mockResolvedValue(response());
    await service.recommend('suave');
    await service.feedback('like');
    await service.feedback('like');
    expect(api.recommendationFeedback).toHaveBeenCalledTimes(1);
    undoLabel.set(RECOMMEND_LABEL);
    await service.feedback('undone');
    expect(store.undo).toHaveBeenCalled();
    expect(api.recommendationFeedback).toHaveBeenLastCalledWith('p1', 'r1', { action: 'undone' });
    expect(service.current()).toBeNull();
  });
});
