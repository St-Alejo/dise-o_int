import { Injectable } from '@angular/core';
import type { CatalogItem } from '@interiores/shared-types';
import * as THREE from 'three';
import { FurnitureFactory } from '../viewport-3d/furniture-factory';

const SIZE = 192;
const DB_NAME = 'interiores-thumbs';
const STORE = 'thumbs';

/** Caché persistente mínima en IndexedDB (si no existe o falla, simplemente no se persiste). */
class ThumbCache {
  private db: Promise<IDBDatabase | null> | null = null;

  private open(): Promise<IDBDatabase | null> {
    this.db ??= new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.db;
  }

  async get(key: string): Promise<string | null> {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => resolve(null);
    });
  }

  async set(key: string, value: string): Promise<void> {
    const db = await this.open();
    if (!db) return;
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
  }
}

/**
 * Miniaturas del catálogo. Los modelos de Poly Haven traen la oficial; el resto (paramétricos y
 * procedurales) se renderizan aquí con UN renderer fuera de pantalla compartido, de a uno por vez
 * (cola) para no bloquear la interfaz, y se guardan en memoria y en IndexedDB. La clave incluye
 * la URL versionada del modelo: si el seed cambia el mueble, la miniatura se regenera.
 */
@Injectable({ providedIn: 'root' })
export class ThumbnailService {
  private readonly memory = new Map<string, Promise<string | null>>();
  private readonly cache = new ThumbCache();
  private readonly factory = new FurnitureFactory();
  private queue: Promise<unknown> = Promise.resolve();
  private renderer: THREE.WebGLRenderer | null | undefined;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;

  get(item: CatalogItem): Promise<string | null> {
    if (item.thumbnailUrl) return Promise.resolve(item.thumbnailUrl);
    const key = `${item.id}|${item.modelUrl}`;
    let p = this.memory.get(key);
    if (!p) {
      p = this.cache.get(key).then(
        (hit) =>
          hit ??
          this.enqueue(() => this.render(item)).then((url) => {
            if (url) void this.cache.set(key, url);
            return url;
          }),
      );
      this.memory.set(key, p);
    }
    return p;
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private setup(): boolean {
    if (this.renderer !== undefined) return this.renderer !== null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setSize(SIZE, SIZE, false);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8a48c, 2.2));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(2, 4, 3);
      this.scene.add(sun);
      this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
      return true;
    } catch {
      this.renderer = null; // sin WebGL (pruebas, navegadores bloqueados): se usa el ícono
      return false;
    }
  }

  private async render(item: CatalogItem): Promise<string | null> {
    if (!this.setup() || !this.renderer || !this.scene || !this.camera) return null;
    let object: THREE.Object3D | null = null;
    try {
      object = await this.factory.create(item);
      this.scene.add(object);
      // Vista 3/4 desde el frente, encuadrando la caja del mueble.
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, 0.05);
      const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.05;
      const dir = new THREE.Vector3(0.75, 0.55, 1).normalize();
      this.camera.position.copy(center).addScaledVector(dir, dist);
      this.camera.near = dist / 100;
      this.camera.far = dist * 4;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(center);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL('image/webp', 0.85);
    } catch (err) {
      console.warn(`[miniaturas] ${item.id}`, err);
      return null;
    } finally {
      // No se libera nada por ítem: los clones comparten geometría y material con la caché del
      // factory (liberarlos rompería las siguientes miniaturas del mismo mueble).
      if (object) this.scene.remove(object);
    }
  }
}
