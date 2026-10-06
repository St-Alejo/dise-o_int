import { Module } from '@nestjs/common';
import { MediaController } from '../public/media.controller.js';
import { PublicController } from '../public/public.controller.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  controllers: [ProjectsController, PublicController, MediaController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
