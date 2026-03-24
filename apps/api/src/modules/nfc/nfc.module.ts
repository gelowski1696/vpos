import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { NfcAuditController } from './nfc-audit.controller';
import { NfcController } from './nfc.controller';
import { NfcService } from './nfc.service';

@Module({
  imports: [PrismaModule, EntitlementsModule, AuditModule],
  controllers: [NfcController, NfcAuditController],
  providers: [NfcService],
  exports: [NfcService]
})
export class NfcModule {}
