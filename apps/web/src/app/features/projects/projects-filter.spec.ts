import type { ProjectListItem } from '@interiores/shared-types';
import { homesOf, filterProjects, oneDecimal, outlineSvg, roomTypesOf, summarize, type ProjectFilter } from './projects-filter';

const project = (over: Partial<ProjectListItem>): ProjectListItem => ({
  id: over.name ?? 'p',
  name: 'Proyecto',
  roomType: 'living',
  status: 'ready',
  thumbnailUrl: null,
  itemCount: 0,
  saved: true,
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

const LIST = [
  project({ name: 'Sala moderna', roomType: 'living', updatedAt: '2026-10-03T10:00:00.000Z', areaM2: 20, itemCount: 6 }),
  project({ name: 'Baño pequeño', roomType: 'bathroom', updatedAt: '2026-10-05T10:00:00.000Z', areaM2: 4.5, itemCount: 3, saved: false }),
  project({ name: 'árbol de ideas', roomType: 'living', updatedAt: '2026-10-01T10:00:00.000Z', itemCount: 1 }),
];
const all: ProjectFilter = { query: '', roomType: 'all', sort: 'recent' };
const names = (filter: Partial<ProjectFilter>) => filterProjects(LIST, { ...all, ...filter }).map((p) => p.name);

describe('filterProjects', () => {
  it('por defecto muestra todos, del más reciente al más antiguo', () => {
    expect(names({})).toEqual(['Baño pequeño', 'Sala moderna', 'árbol de ideas']);
  });

  it('el buscador no distingue mayúsculas ni acentos', () => {
    expect(names({ query: '  BANO ' })).toEqual(['Baño pequeño']);
    expect(names({ query: 'Árbol' })).toEqual(['árbol de ideas']);
  });

  it('el tipo de cuarto se combina con el buscador', () => {
    expect(names({ roomType: 'living' })).toEqual(['Sala moderna', 'árbol de ideas']);
    expect(names({ roomType: 'living', query: 'sala' })).toEqual(['Sala moderna']);
    expect(names({ roomType: 'bathroom', query: 'sala' })).toEqual([]);
  });

  it('ordena por nombre a la manera del español y por área con los que no la tienen al final', () => {
    expect(names({ sort: 'name' })).toEqual(['árbol de ideas', 'Baño pequeño', 'Sala moderna']);
    expect(names({ sort: 'area' })).toEqual(['Sala moderna', 'Baño pequeño', 'árbol de ideas']);
  });

  it('no cambia la lista original', () => {
    const before = LIST.map((p) => p.name);
    filterProjects(LIST, { ...all, sort: 'name' });
    expect(LIST.map((p) => p.name)).toEqual(before);
  });
});

describe('resumen de la lista', () => {
  it('cuenta proyectos, los que faltan por guardar, muebles y superficie', () => {
    expect(summarize(LIST)).toEqual({ total: 3, unsaved: 1, pieces: 10, areaM2: 24.5 });
    expect(summarize([])).toEqual({ total: 0, unsaved: 0, pieces: 0, areaM2: 0 });
  });

  it('encuadra el contorno de la planta con un margen', () => {
    const svg = outlineSvg([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }]);
    expect(svg.points).toBe('0,0 4,0 4,3 0,3');
    expect(svg.viewBox).toBe('-0.48 -0.48 4.96 3.96');
  });

  it('escribe los decimales con coma', () => {
    expect(oneDecimal(10.84)).toBe('10,8');
    expect(oneDecimal(14)).toBe('14,0');
  });

  it('lista los tipos de cuarto presentes sin repetir', () => {
    expect(roomTypesOf(LIST)).toEqual(['living', 'bathroom']);
  });
});

describe('homesOf', () => {
  const room = (id: string, extra: Partial<ProjectListItem> = {}): ProjectListItem =>
    ({ id, name: id, roomType: 'living', status: 'ready', thumbnailUrl: null, itemCount: 2, saved: true, updatedAt: '2026-01-01T00:00:00.000Z', ...extra }) as ProjectListItem;

  it('agrupa los cuartos de cada vivienda y suma área, piezas y total', () => {
    const homes = homesOf([
      room('sala', { homeId: 'h1', homeName: 'Piso', areaM2: 20, estimatedTotal: 1000 }),
      room('suelto'),
      room('cocina', { homeId: 'h1', homeName: 'Piso', areaM2: 9.5, estimatedTotal: 500, itemCount: 5 }),
      room('estudio', { homeId: 'h2', homeName: 'Ático' }),
    ]);
    expect(homes.map((h) => h.name)).toEqual(['Ático', 'Piso']);
    expect(homes[1]).toMatchObject({ id: 'h1', areaM2: 29.5, pieces: 7, total: 1500 });
    expect(homes[1]!.rooms.map((r) => r.name)).toEqual(['sala', 'cocina']);
  });

  it('sin viviendas no hay nada que agrupar', () => {
    expect(homesOf([room('a'), room('b')])).toEqual([]);
  });
});
