import { Module } from '@nestjs/common';
import { DesktopUpdatesController } from './desktop-updates.controller';
import { DesktopUpdatesService } from './desktop-updates.service';

@Module({
  controllers: [DesktopUpdatesController],
  providers: [DesktopUpdatesService]
})
export class DesktopUpdatesModule {}
