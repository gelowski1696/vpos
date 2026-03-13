import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { EntitlementsController } from './entitlements.controller';
import { EntitlementsService } from './entitlements.service';
import { SubscriptionGatewayService } from './subscription-gateway.service';
import { AuthModule } from '../auth/auth.module';
import { TenantRoutingPolicyService } from './tenant-routing-policy.service';
import { DedicatedTenantProvisioningService } from './dedicated-tenant-provisioning.service';
import { SubmanTokenService } from './subman-token.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [EntitlementsController],
  providers: [
    EntitlementsService,
    SubscriptionGatewayService,
    SubmanTokenService,
    TenantRoutingPolicyService,
    DedicatedTenantProvisioningService
  ],
  exports: [EntitlementsService, TenantRoutingPolicyService]
})
export class EntitlementsModule {}
