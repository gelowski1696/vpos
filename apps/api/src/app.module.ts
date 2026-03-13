import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { SyncModule } from './modules/sync/sync.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { SalesModule } from './modules/sales/sales.module';
import { PrintingModule } from './modules/printing/printing.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { BrandingModule } from './modules/branding/branding.module';
import { CylindersModule } from './modules/cylinders/cylinders.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AiExportModule } from './modules/ai-export/ai-export.module';
import { PrismaModule } from './common/prisma.module';
import { TenantContextMiddleware } from './common/tenant-context.middleware';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { AuditModule } from './modules/audit/audit.module';
import { CustomerPaymentsModule } from './modules/customer-payments/customer-payments.module';
import { MobileEnrollmentModule } from './modules/mobile-enrollment/mobile-enrollment.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthModule,
    SyncModule,
    EntitlementsModule,
    MasterDataModule,
    PricingModule,
    SalesModule,
    PrintingModule,
    ReviewsModule,
    BrandingModule,
    CylindersModule,
    TransfersModule,
    DeliveryModule,
    CustomerPaymentsModule,
    MobileEnrollmentModule,
    ReportsModule,
    AiExportModule
  ],
  providers: [TenantContextMiddleware]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
