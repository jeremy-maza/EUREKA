import { Module } from '@nestjs/common';
import { ProgressionManager } from './progression-manager';

@Module({
  providers: [{ provide: ProgressionManager, useFactory: () => new ProgressionManager() }],
  exports: [ProgressionManager],
})
export class ProgressionModule {}
