/**
 * Baño privado en un clic: dónde va (la plantilla de esquina) y con qué acabados (tipos de baño).
 * Funciones puras: devuelven el cuarto y los acabados nuevos, o lanzan `RoomGeometryError`.
 */
import type { RoomFinishes, RoomShell, Zone, ZoneFinishes } from './domain.js';
import { RoomGeometryError, validateRoomShell } from './geometry.js';
import { cornerZone } from './zones.js';

export interface BathroomPreset {
  id: string;
  label: string;
  finishes: ZoneFinishes;
}

/** Tipos de baño: piso, pintura y revestimiento que combinan entre sí. */
export const BATHROOM_PRESETS: readonly BathroomPreset[] = [
  {
    id: 'ducha-obra',
    label: 'Ducha de obra con baldosa de metro',
    finishes: { floor: 'ceramic-grey-tile', walls: 'paint-white', wallTiles: { material: 'ceramic-subway-white', heightM: 2.1 } },
  },
  {
    id: 'banera-mampara',
    label: 'Bañera con mampara',
    finishes: { floor: 'ceramic-white', walls: 'paint-greige', wallTiles: { material: 'ceramic-square-wall', heightM: 1.2 } },
  },
  {
    id: 'spa-marmol',
    label: 'Spa en mármol',
    finishes: { floor: 'stone-marble-white', walls: 'paint-greige', wallTiles: { material: 'stone-marble-white', heightM: 2.4 } },
  },
  {
    id: 'industrial',
    label: 'Industrial en microcemento',
    finishes: { floor: 'stone-microcement', walls: 'paint-white', wallTiles: { material: 'stone-slate', heightM: 1.2 } },
  },
];

export function bathroomPreset(id: string): BathroomPreset | undefined {
  return BATHROOM_PRESETS.find((p) => p.id === id);
}

/** Medidas que se prueban, de la cómoda a la mínima (con ducha, lavamanos e inodoro). */
const BATH_SIZES: readonly [number, number][] = [
  [2.2, 1.7],
  [2, 1.6],
  [1.8, 1.5],
  [1.6, 1.4],
];

const MAX_ZONES = 4;

export interface ZoneEditResult {
  shell: RoomShell;
  finishes: RoomFinishes;
  zone: Zone;
}

/**
 * Añade un baño privado en el rincón más alejado de la puerta, del tamaño más cómodo que quepa,
 * con los acabados del tipo de baño elegido.
 */
export function addPrivateBathroom(shell: RoomShell, finishes: RoomFinishes, presetId = 'ducha-obra'): ZoneEditResult {
  const preset = bathroomPreset(presetId);
  if (!preset) throw new RoomGeometryError(`No existe el tipo de baño "${presetId}"`);
  const zones = shell.zones ?? [];
  if (zones.length >= MAX_ZONES) throw new RoomGeometryError(`Un cuarto admite hasta ${MAX_ZONES} zonas`);
  let n = zones.length + 1;
  while (zones.some((z) => z.id === `bano-${n}`)) n++;
  const id = `bano-${n}`;
  const name = zones.some((z) => z.kind === 'bathroom') ? `Baño ${n}` : 'Baño privado';
  for (const [widthM, depthM] of BATH_SIZES) {
    // Se prueba en las dos orientaciones: a lo largo de una pared o de la otra.
    for (const [w, d] of [
      [widthM, depthM],
      [depthM, widthM],
    ] as const) {
      const zone = cornerZone(shell, { id, kind: 'bathroom', name, widthM: w, depthM: d });
      if (!zone) continue;
      const next = { ...shell, zones: [...zones, zone] };
      // Al cuarto le tiene que quedar sitio: un baño no se come más de la mitad.
      if (w * d > (shell.widthM * shell.depthM) / 2) continue;
      validateRoomShell(next);
      return { shell: next, finishes: { ...finishes, zones: { ...finishes.zones, [id]: structuredClone(preset.finishes) } }, zone };
    }
  }
  throw new RoomGeometryError('No hay un rincón donde quepa un baño (mínimo 1,6 × 1,4 m) sin quitarle medio cuarto');
}

/** Cambia el tipo de baño (los acabados) de una zona. */
export function setZonePreset(finishes: RoomFinishes, zoneId: string, presetId: string): RoomFinishes {
  const preset = bathroomPreset(presetId);
  if (!preset) throw new RoomGeometryError(`No existe el tipo de baño "${presetId}"`);
  return { ...finishes, zones: { ...finishes.zones, [zoneId]: structuredClone(preset.finishes) } };
}

/** Quita una zona y sus acabados; el cuarto vuelve a ser un solo espacio en esa parte. */
export function removeZone(shell: RoomShell, finishes: RoomFinishes, zoneId: string): { shell: RoomShell; finishes: RoomFinishes } {
  const zones = (shell.zones ?? []).filter((z) => z.id !== zoneId);
  const rest = { ...finishes.zones };
  delete rest[zoneId];
  const nextShell: RoomShell = { ...shell };
  if (zones.length) nextShell.zones = zones;
  else delete nextShell.zones;
  const nextFinishes: RoomFinishes = { ...finishes };
  if (Object.keys(rest).length) nextFinishes.zones = rest;
  else delete nextFinishes.zones;
  return { shell: nextShell, finishes: nextFinishes };
}
