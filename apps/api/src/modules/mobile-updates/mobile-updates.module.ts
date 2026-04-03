import { Module } from '@nestjs/common';
import { MobileUpdatesController } from './mobile-updates.controller';
import { MobileUpdatesService } from './mobile-updates.service';

@Module({
  controllers: [MobileUpdatesController],
  providers: [MobileUpdatesService]
})
export class MobileUpdatesModule {}
