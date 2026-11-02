import { Injectable, computed, inject, signal } from '@angular/core';
import { checkCompliance, type ComplianceReport } from '@interiores/shared-types';
import { ProModeService } from '../../core/ui/pro-mode.service';
import { DesignProjectStore } from '../project/design-project.store';

/**
 * Revisión normativa del cuarto tal como está en pantalla (Modo Pro). Vive con el editor, como la
 * revisión del diseño, y se recalcula con cada cambio; sin Modo Pro no calcula nada.
 */
@Injectable()
export class ComplianceService {
  private readonly store = inject(DesignProjectStore);
  private readonly pro = inject(ProModeService);

  /** Hora solar con la que se muestra la luz natural. */
  readonly hour = signal(12);

  readonly report = computed<ComplianceReport | null>(() => {
    if (!this.pro.enabled()) return null;
    const shell = this.store.shell();
    const project = this.store.project();
    if (!shell || !project) return null;
    return checkCompliance({ shell, pieces: this.store.designPieces(), roomType: project.roomType, compliance: this.store.technical().compliance, installations: this.store.technical().installations, hour: this.hour() });
  });

  /** Lo que no cumple o merece un aviso: lo que se muestra también en la revisión del diseño. */
  readonly pending = computed(() => this.report()?.findings.filter((f) => f.status === 'fail' || f.status === 'warn') ?? []);
}
