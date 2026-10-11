import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SegmentedComponent, type SegmentOption } from './segmented.component';
import { tabAfterKey } from './tabs';

@Component({
  imports: [SegmentedComponent],
  template: `<app-segmented label="Luz" [options]="options" [(value)]="light" />`,
})
class Host {
  readonly options: SegmentOption<'dia' | 'noche'>[] = [
    { id: 'dia', label: 'Día', title: 'Con sol' },
    { id: 'noche', label: 'Noche' },
  ];
  readonly light = signal<'dia' | 'noche'>('dia');
}

describe('SegmentedComponent', () => {
  it('es un grupo con nombre; solo la opción elegida está pulsada y elegir otra la cambia', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = [...el.querySelectorAll('button')];
    expect(el.querySelector('[role=group]')!.getAttribute('aria-label')).toBe('Luz');
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(buttons[0]!.getAttribute('title')).toBe('Con sol');
    expect(buttons[1]!.hasAttribute('title')).toBe(false);

    buttons[1]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.light()).toBe('noche');
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  });
});

describe('tabAfterKey (teclado de unas pestañas)', () => {
  it('las flechas dan la vuelta, Inicio y Fin van a los extremos y lo demás no navega', () => {
    expect(tabAfterKey('ArrowRight', 4, 5)).toBe(0);
    expect(tabAfterKey('ArrowLeft', 0, 5)).toBe(4);
    expect(tabAfterKey('Home', 3, 5)).toBe(0);
    expect(tabAfterKey('End', 1, 5)).toBe(4);
    expect(tabAfterKey('a', 1, 5)).toBeNull();
  });
});
