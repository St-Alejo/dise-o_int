import { Module } from '@nestjs/common';
import { RendersController } from './renders.controller.js';
import { RendersService } from './renders.service.js';

/** Estudio de render (plan v9): la galería de imágenes, fotos realistas y vídeos de cada proyecto. */
@Module({
  controllers: [RendersController],
  providers: [RendersService],
  exports: [RendersService],
})
export class RendersModule {}
