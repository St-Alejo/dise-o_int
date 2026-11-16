import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '../../config/env.js';
import { APP_CONFIG, type IPlano3dLinkRepository, type Plano3dLinkRecord } from '../../ports/index.js';
import { PrismaService } from './prisma.service.js';

/**
 * Casas enlazadas con Plano 3D. El token de enlace abre esa casa en la otra app, así que se
 * guarda cifrado (AES-256-GCM con una clave derivada del secreto de firma de medios).
 */
@Injectable()
export class PrismaPlano3dLinkRepository implements IPlano3dLinkRepository {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.key = createHash('sha256').update(`plano3d-link:${config.MEDIA_SIGNING_SECRET}`).digest();
  }

  async create(data: Omit<Plano3dLinkRecord, 'createdAt' | 'lastSeq' | 'revokedAt'>): Promise<Plano3dLinkRecord> {
    const row = await this.prisma.plano3dLink.create({ data: { ...data, linkToken: this.seal(data.linkToken) } });
    return this.toRecord(row);
  }

  async findById(id: string): Promise<Plano3dLinkRecord | null> {
    const row = await this.prisma.plano3dLink.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async listByOwner(ownerId: string): Promise<Plano3dLinkRecord[]> {
    const rows = await this.prisma.plano3dLink.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toRecord(r));
  }

  async listActive(): Promise<Plano3dLinkRecord[]> {
    const rows = await this.prisma.plano3dLink.findMany({ where: { revokedAt: null, tokenExpiresAt: { gt: new Date() } } });
    return rows.map((r) => this.toRecord(r));
  }

  async update(id: string, patch: Partial<Pick<Plano3dLinkRecord, 'lastSeq' | 'revokedAt' | 'linkToken' | 'tokenExpiresAt'>>): Promise<void> {
    const { linkToken, ...rest } = patch;
    await this.prisma.plano3dLink.update({ where: { id }, data: { ...rest, ...(linkToken !== undefined ? { linkToken: this.seal(linkToken) } : {}) } });
  }

  private toRecord(row: {
    id: string;
    ownerId: string;
    homeId: string;
    plano3dProjectId: string;
    projectName: string;
    linkToken: string;
    tokenExpiresAt: Date;
    lastSeq: number;
    revokedAt: Date | null;
    createdAt: Date;
  }): Plano3dLinkRecord {
    return {
      id: row.id,
      ownerId: row.ownerId,
      homeId: row.homeId,
      plano3dProjectId: row.plano3dProjectId,
      projectName: row.projectName,
      linkToken: this.open(row.linkToken),
      tokenExpiresAt: row.tokenExpiresAt,
      lastSeq: row.lastSeq,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    };
  }

  private seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  private open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !data) return '';
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      return ''; // otra clave: el enlace hay que volver a hacerlo
    }
  }
}
