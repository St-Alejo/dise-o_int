import type { Vector3 } from '@interiores/shared-types';

export const delta = (from: Vector3, to: Vector3): Vector3 => ({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });

export const shifted = (p: Vector3, d: Vector3): Vector3 => ({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z });
