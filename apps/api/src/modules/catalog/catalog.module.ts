import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { TexturesController } from './textures.controller.js';

@Module({ controllers: [CatalogController, TexturesController], providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
