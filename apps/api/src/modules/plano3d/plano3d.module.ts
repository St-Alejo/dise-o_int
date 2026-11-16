import { Module } from '@nestjs/common';
import { ProgressGateway } from '../progress/progress.gateway.js';
import { ProgressModule } from '../progress/progress.module.js';
import { Plano3dController } from './plano3d.controller.js';
import { Plano3dService, SCENE_SYNC } from './plano3d.service.js';

@Module({
  imports: [ProgressModule],
  controllers: [Plano3dController],
  providers: [Plano3dService, { provide: SCENE_SYNC, useExisting: ProgressGateway }],
  exports: [Plano3dService],
})
export class Plano3dModule {}
