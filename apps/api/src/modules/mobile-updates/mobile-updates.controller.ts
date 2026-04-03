import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { MobileUpdatesService } from './mobile-updates.service';

@Controller('mobile-updates')
export class MobileUpdatesController {
  constructor(private readonly mobileUpdatesService: MobileUpdatesService) {}

  @Public()
  @Get('latest')
  getLatestAndroidManifest(): ReturnType<MobileUpdatesService['getLatestAndroidManifest']> {
    return this.mobileUpdatesService.getLatestAndroidManifest();
  }
}
