import { Module } from '@nestjs/common';
import { AttemptAnalyticsService } from './attempt-analytics.service';
import { StatisticsService } from './statistics.service';

@Module({
  providers: [StatisticsService, AttemptAnalyticsService],
  exports: [StatisticsService, AttemptAnalyticsService],
})
export class StatisticsModule {}
