import { Module } from '@nestjs/common';
import { CylindersController } from './cylinders.controller';
import { CylindersService } from './cylinders.service';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { PrismaModule } from '../../common/prisma.module';

@Module({
  imports: [EntitlementsModule, PrismaModule],
  controllers: [CylindersController],
  providers: [CylindersService]
})
export class CylindersModule {}
