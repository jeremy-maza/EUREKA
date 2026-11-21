import { Module } from '@nestjs/common';
import { ProgressionManager } from './progression-manager';
import { ProgressionService } from './progression.service';

@Module({
  providers: [
    { provide: ProgressionManager, useFactory: () => new ProgressionManager() },
    ProgressionService,
  ],
  exports: [ProgressionManager, ProgressionService],
})
export class ProgressionModule {}
