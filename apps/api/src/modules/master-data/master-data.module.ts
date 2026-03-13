import { Module } from '@nestjs/common';
import { MasterDataController } from './master-data.controller';
import { MasterDataService } from './master-data.service';
import { PrismaModule } from '../../common/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';

@Module({
  imports: [PrismaModule, AuthModule, EntitlementsModule],
  controllers: [MasterDataController],
  providers: [MasterDataService],
  exports: [MasterDataService]
})
export class MasterDataModule {}
