import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProgressGateway } from './progress.gateway.js';

@Module({ imports: [AuthModule], providers: [ProgressGateway], exports: [ProgressGateway] })
export class ProgressModule {}
