import { Readable } from 'node:stream';
import type { IFileStorage, StoredObject } from '../../ports/index.js';

/** Almacenamiento en memoria para tests (mismo contrato que S3FileStorage). */
export class MemoryFileStorage implements IFileStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string; lastModified: Date }>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType, lastModified: new Date() });
  }

  async get(key: string): Promise<StoredObject | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return { body: Readable.from(obj.body), contentType: obj.contentType, contentLength: obj.body.length };
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    return this.objects.get(key)?.body ?? null;
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async deletePrefix(prefix: string): Promise<number> {
    let n = 0;
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
        n++;
      }
    }
    return n;
  }

  async *listObjects(prefix: string): AsyncIterable<{ key: string; lastModified: Date }> {
    for (const [key, obj] of this.objects.entries()) {
      if (key.startsWith(prefix)) yield { key, lastModified: obj.lastModified };
    }
  }

  async ensureBucket(): Promise<void> {}
  async ping(): Promise<void> {}
}
