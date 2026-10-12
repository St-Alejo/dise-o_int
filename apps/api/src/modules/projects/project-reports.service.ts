import { arrangeHome, describeVariant, effectiveDimensions, footprint, ROOM_TYPE_LABELS, RoomPlan, type ShoppingList, STYLES } from '@interiores/shared-types';
import { ValidationError } from '../../common/errors.js';
import type { ICatalogRepository, IProjectRepository, ProjectRecord } from '../../ports/index.js';
import type { HomeDossier, ProjectDossier } from './shopping-list.pdf.js';
import type { Actor, ProjectAccess } from './project-access.js';

/** Lo que se saca de un cuarto para llevárselo: la lista de compras y el dossier en PDF. */
export class ProjectReports {
  constructor(
    private readonly catalog: ICatalogRepository,
    private readonly access: ProjectAccess,
    private readonly projects: IProjectRepository,
  ) {}

  async shoppingList(actor: Actor, id: string): Promise<ShoppingList> {
    return this.buildShoppingList(await this.access.own(actor, id));
  }

  /** Lo que lleva el dossier en PDF: la ficha del cuarto, su planta con muebles y la lista de compras. */
  async dossier(actor: Actor, id: string): Promise<ProjectDossier> {
    return this.dossierOf(await this.access.own(actor, id));
  }

  /**
   * La vivienda del cuarto `id`, entera: cada cuarto ya listo, con su dossier y su sitio en la
   * planta conjunta (el guardado, o en fila si aún no se colocó: igual que la ve la web).
   */
  async homeDossier(actor: Actor, id: string): Promise<HomeDossier> {
    const project = await this.access.own(actor, id);
    if (!project.homeId) throw new ValidationError('Este cuarto no está en ninguna vivienda');
    const rooms = (await this.projects.listByOwner(actor.userId))
      .filter((p) => p.homeId === project.homeId && p.roomShell)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const outlines = new Map(rooms.map((room) => [room.id, RoomPlan.from(room.roomShell!).polygon.map((p) => ({ x: p.x, z: p.z }))]));
    const positions = arrangeHome(rooms.map((room) => ({ id: room.id, outline: outlines.get(room.id)!, position: room.homePosition ?? null })));
    return {
      name: project.homeName ?? 'Vivienda',
      rooms: await Promise.all(
        rooms.map(async (room) => {
          const at = positions.get(room.id) ?? { x: 0, z: 0 };
          return {
            dossier: await this.dossierOf(room),
            outline: outlines.get(room.id)!.map((p) => ({ x: p.x + at.x, z: p.z + at.z })),
            budgetCap: room.budgetCap ?? null,
          };
        }),
      ),
    };
  }

  private async dossierOf(project: ProjectRecord): Promise<ProjectDossier> {
    const shell = this.access.requireShell(project);
    const items = new Map((await this.catalog.findByIds(project.placements.map((p) => p.catalogItemId))).map((i) => [i.id, i]));
    const pieces = project.placements.flatMap((p) => {
      const item = items.get(p.catalogItemId);
      // En planta se dibuja lo que pisa el suelo; lo colgado y lo apoyado encima solo estorbaría.
      if (!item || item.mount !== 'floor' || p.supportId || item.subcategory === 'rug') return [];
      const dims = effectiveDimensions({ x: item.widthM, y: item.heightM, z: item.depthM }, p);
      return [{ name: item.name, corners: footprint(p.position, dims, p.rotationY).corners.map((c) => ({ x: c.x, z: c.z })) }];
    });
    const style = project.selectedStyleId ? STYLES[project.selectedStyleId].label : null;
    return {
      name: project.name,
      subtitle: [ROOM_TYPE_LABELS[project.roomType], style].filter(Boolean).join(' · '),
      shell,
      areaM2: RoomPlan.from(shell).area(),
      pieces,
      pieceCount: project.placements.length,
      list: await this.buildShoppingList(project),
    };
  }

  async buildShoppingList(project: ProjectRecord): Promise<ShoppingList> {
    const items = new Map((await this.catalog.findByIds(project.placements.map((p) => p.catalogItemId))).map((i) => [i.id, i]));
    // Una línea por producto Y variante: un sofá de catálogo y otro a medida en cuero son distintos.
    const groups = new Map<string, { itemId: string; variant: string | null; quantity: number }>();
    for (const p of project.placements) {
      const item = items.get(p.catalogItemId);
      if (!item) continue;
      const variant = describeVariant(
        { dimensionsM: { x: item.widthM, y: item.heightM, z: item.depthM }, materialSlots: item.spec?.materialSlots },
        p,
      );
      const key = `${p.catalogItemId}|${variant ?? ''}`;
      const g = groups.get(key) ?? { itemId: p.catalogItemId, variant, quantity: 0 };
      g.quantity++;
      groups.set(key, g);
    }

    const lines = [...groups.values()].flatMap(({ itemId, variant, quantity }) => {
      const item = items.get(itemId);
      if (!item) return [];
      return [
        {
          catalogItemId: item.id,
          name: item.name,
          variant,
          category: item.category,
          quantity,
          unitPrice: item.price,
          subtotal: item.price === null ? null : Math.round(item.price * quantity * 100) / 100,
          currency: item.currency,
          productUrl: item.productUrl,
          license: item.license,
          attribution: item.attribution,
        },
      ];
    });
    lines.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || (a.variant ?? '').localeCompare(b.variant ?? ''));
    const total = Math.round(lines.reduce((acc, l) => acc + (l.subtotal ?? 0), 0) * 100) / 100;
    return { projectId: project.id, projectName: project.name, lines, total, currency: lines[0]?.currency ?? 'USD' };
  }
}
