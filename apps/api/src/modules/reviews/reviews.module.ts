import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [SyncModule],
  controllers: [ReviewsController]
})
export class ReviewsModule {}
