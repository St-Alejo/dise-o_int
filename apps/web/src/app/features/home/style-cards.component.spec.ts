import { styleLink } from './style-cards.component';

describe('styleLink', () => {
  it('con sesión lleva al asistente con el estilo elegido', () => {
    expect(styleLink('industrial', true)).toEqual({ path: '/proyectos/nuevo', query: { estilo: 'industrial' } });
  });

  it('sin sesión pasa por el registro y vuelve al asistente con el estilo', () => {
    expect(styleLink('bohemio', false)).toEqual({ path: '/registro', query: { volver: '/proyectos/nuevo?estilo=bohemio' } });
  });
});
