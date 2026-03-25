import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { VcardAuditController } from './vcard-audit.controller';
import { VcardCardsController } from './vcard-cards.controller';
import { VcardController } from './vcard.controller';
import { VcardInventoryController } from './vcard-inventory.controller';
import { VcardPointsController } from './vcard-points.controller';
import { VcardService } from './vcard.service';

@Module({
  imports: [PrismaModule, EntitlementsModule, AuditModule],
  controllers: [
    VcardController,
    VcardInventoryController,
    VcardCardsController,
    VcardPointsController,
    VcardAuditController
  ],
  providers: [VcardService],
  exports: [VcardService]
})
export class VcardModule {}
