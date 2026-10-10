import { describe, expect, it } from 'vitest';
import { NewProjectWizard } from './wizard.store';

const photo = new File(['x'], 'cuarto.jpg', { type: 'image/jpeg' });

describe('NewProjectWizard', () => {
  it('no avanza hasta que el paso actual está completo', () => {
    const wizard = new NewProjectWizard();
    expect(wizard.step().id).toBe('source');
    expect(wizard.problem()).toBe('Sube una foto o elige empezar sin foto.');
    expect(wizard.next()).toBe(false);

    wizard.chooseSource('photo');
    expect(wizard.problem()).toBe('Elige la foto de tu cuarto.');
    wizard.chooseSource('photo', photo);
    expect(wizard.next()).toBe(true);
    expect(wizard.step().id).toBe('room');
  });

  it('con foto: la forma la decide la foto y las medidas son opcionales, las tres o ninguna', () => {
    const wizard = new NewProjectWizard();
    wizard.chooseSource('photo', photo);
    wizard.next();
    expect(wizard.data().shape).toBe('auto');
    expect(wizard.problem()).toBeNull();

    wizard.patch({ widthM: 4.2 });
    expect(wizard.problem()).toMatch(/ancho, largo y alto/);
    wizard.patch({ depthM: 3.5, heightM: 9 });
    expect(wizard.problem()).toBe('El alto debe estar entre 2 y 6 m.');
    wizard.patch({ heightM: 2.5 });
    expect(wizard.problem()).toBeNull();

    wizard.next();
    expect(wizard.request()).toEqual({
      photo,
      name: 'Mi cuarto',
      roomType: 'living',
      styles: ['escandinavo', 'moderno', 'industrial'],
      room: { widthM: 4.2, depthM: 3.5, heightM: 2.5 },
    });
  });

  it('sin foto: parte de un rectángulo con medidas típicas y ya tiene plano', () => {
    const wizard = new NewProjectWizard();
    wizard.chooseSource('manual');
    expect(wizard.data()).toMatchObject({ shape: 'rect', widthM: 4, depthM: 3.5, heightM: 2.5, photo: null });
    wizard.next();
    expect(wizard.room().shell!.walls).toHaveLength(4);
    wizard.next();
    expect(wizard.request()).toMatchObject({ photo: null, roomSpec: { shape: 'rect', widthM: 4, depthM: 3.5, heightM: 2.5 } });
    expect(wizard.request()!.room).toBeUndefined();
  });

  it('elegir una forma propone su muesca y el plano la refleja al cambiarla', () => {
    const wizard = new NewProjectWizard();
    wizard.chooseSource('manual');
    wizard.patch({ widthM: 5, depthM: 4 });
    wizard.chooseShape('L');
    expect(wizard.data()).toMatchObject({ shape: 'L', notchWidthM: 2, notchDepthM: 1.6 });
    expect(wizard.room().shell!.walls).toHaveLength(6);

    wizard.patch({ notchWidthM: 3 });
    expect(wizard.room().spec).toMatchObject({ shape: 'L', notchWidthM: 3, notchDepthM: 1.6 });
    // Una muesca imposible se acota a lo que la forma admite en vez de dar error.
    wizard.patch({ notchWidthM: 40 });
    expect(wizard.room().spec!.notchWidthM).toBe(4.6);

    wizard.chooseShape('U');
    expect(wizard.room().shell!.walls).toHaveLength(8);
    wizard.chooseShape('rect');
    expect(wizard.data().notchWidthM).toBeNull();
    expect(wizard.room().spec).toEqual({ shape: 'rect', widthM: 5, depthM: 4, heightM: 2.5 });
  });

  it('con foto también se puede elegir la forma a mano', () => {
    const wizard = new NewProjectWizard();
    wizard.chooseSource('photo', photo);
    wizard.chooseShape('T');
    expect(wizard.data()).toMatchObject({ shape: 'T', widthM: 4, depthM: 3.5 });
    wizard.goTo(2);
    expect(wizard.request()).toMatchObject({ photo, roomSpec: { shape: 'T' } });
  });

  it('medidas fuera de rango bloquean el paso con un mensaje claro', () => {
    const wizard = new NewProjectWizard();
    wizard.chooseSource('manual');
    wizard.next();
    wizard.patch({ widthM: 0.3 });
    expect(wizard.problem()).toBe('El ancho debe estar entre 0.8 y 30 m.');
    wizard.patch({ widthM: null });
    expect(wizard.problem()).toBe('Escribe el ancho, el largo y el alto del cuarto.');
    expect(wizard.next()).toBe(false);
    expect(wizard.request()).toBeNull();
  });

  it('el último paso pide nombre y entre uno y cuatro estilos', () => {
    const wizard = new NewProjectWizard();
    wizard.chooseSource('manual');
    wizard.goTo(2);
    expect(wizard.isLast()).toBe(true);
    wizard.patch({ name: '   ' });
    expect(wizard.problem()).toBe('Ponle un nombre al proyecto.');
    wizard.patch({ name: 'Estudio', styles: [] });
    expect(wizard.problem()).toBe('Elige al menos un estilo.');
    wizard.toggleStyle('bohemio');
    expect(wizard.ready()).toBe(true);
    expect(wizard.request()).toMatchObject({ name: 'Estudio', styles: ['bohemio'] });
  });

  it('solo se salta a un paso si los anteriores están completos; volver siempre se puede', () => {
    const wizard = new NewProjectWizard();
    wizard.goTo(2);
    expect(wizard.index()).toBe(0);
    wizard.chooseSource('manual');
    wizard.goTo(2);
    expect(wizard.index()).toBe(2);
    wizard.back();
    wizard.back();
    wizard.back();
    expect(wizard.index()).toBe(0);
  });
});
