import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { DesktopUpdatesService } from './desktop-updates.service';

@Controller('desktop-updates')
export class DesktopUpdatesController {
  constructor(private readonly desktopUpdatesService: DesktopUpdatesService) {}

  @Public()
  @Get('policy')
  getPolicy(
    @Query('platform') platform?: string,
    @Query('arch') arch?: string,
    @Query('version') version?: string,
    @Query('device_id') deviceId?: string
  ): ReturnType<DesktopUpdatesService['getPolicy']> {
    return this.desktopUpdatesService.getPolicy({ platform, arch, version, deviceId });
  }
}
