import { Module } from '@nestjs/common';
import { BlenderRendersService } from './blender-renders.service.js';
import { RenderNodeController, RendersController } from './renders.controller.js';
import { RendersService } from './renders.service.js';

/** Estudio de render (planes v9 y v10): la galería de cada proyecto y los renders en Blender. */
@Module({
  controllers: [RendersController, RenderNodeController],
  providers: [RendersService, BlenderRendersService],
  exports: [RendersService],
})
export class RendersModule {}
