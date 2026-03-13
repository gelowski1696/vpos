import { Module } from '@nestjs/common';
import { AiExportController } from './ai-export.controller';
import { AiExportService } from './ai-export.service';
import { PrismaModule } from '../../common/prisma.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';

@Module({
  imports: [PrismaModule, EntitlementsModule],
  controllers: [AiExportController],
  providers: [AiExportService]
})
export class AiExportModule {}
