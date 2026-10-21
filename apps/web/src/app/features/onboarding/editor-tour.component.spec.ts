import { TestBed } from '@angular/core/testing';
import { EditorTourComponent, TOUR_STEPS, markTourSeen, tourSeen } from './editor-tour.component';

describe('primeros pasos del editor', () => {
  beforeEach(() => localStorage.clear());

  function render() {
    const fixture = TestBed.createComponent(EditorTourComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (name: string) => [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === name)!;
    return { fixture, el, button };
  }

  it('la primera vez sale, se recorre paso a paso y no vuelve', () => {
    const { fixture, el, button } = render();
    expect(el.textContent).toContain(`1 de ${TOUR_STEPS.length}`);
    expect(el.textContent).toContain(TOUR_STEPS[0]!.title);
    for (let i = 1; i < TOUR_STEPS.length; i++) {
      button('Siguiente').click();
      fixture.detectChanges();
      expect(el.textContent).toContain(TOUR_STEPS[i]!.title);
    }
    button('Entendido').click();
    fixture.detectChanges();
    expect(el.querySelector('.tour')).toBeNull();
    expect(tourSeen()).toBe(true);
    expect(render().el.querySelector('.tour')).toBeNull();
  });

  it('en la demo sin cuenta no habla de Recomendar ni del asistente', () => {
    const fixture = TestBed.createComponent(EditorTourComponent);
    fixture.componentRef.setInput('demo', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const shown = TOUR_STEPS.filter((s) => !s.account);
    expect(el.textContent).toContain(`1 de ${shown.length}`);
    expect(shown.some((s) => s.title === 'Recomendar')).toBe(false);
  });

  it('saltarla también la da por vista', () => {
    const { fixture, el, button } = render();
    button('Saltar').click();
    fixture.detectChanges();
    expect(el.querySelector('.tour')).toBeNull();
    expect(tourSeen()).toBe(true);
  });

  it('sin almacenamiento no se repite en cada visita ni rompe nada', () => {
    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(tourSeen(broken)).toBe(true);
    expect(() => markTourSeen(broken)).not.toThrow();
    expect(tourSeen(null)).toBe(false);
  });
});
