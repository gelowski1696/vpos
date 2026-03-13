import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';
import { PrismaModule } from '../../common/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BrandingController],
  providers: [BrandingService],
  exports: [BrandingService]
})
export class BrandingModule {}
