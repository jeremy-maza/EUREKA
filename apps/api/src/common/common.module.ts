import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock';
import { RandomSeedSource, SeedSource } from './seed-source';

@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    { provide: SeedSource, useClass: RandomSeedSource },
  ],
  exports: [Clock, SeedSource],
})
export class CommonModule {}
