import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { CompanyContextService } from './company-context.service';
import { RequestContextService } from './request-context.service';
import { TenantDatasourceRouterService } from './tenant-datasource-router.service';
import { DatastoreRegistryService } from './datastore-registry.service';
import { AiEventBufferService } from './ai-event-buffer.service';

@Module({
  providers: [
    PrismaService,
    CompanyContextService,
    RequestContextService,
    DatastoreRegistryService,
    TenantDatasourceRouterService,
    AiEventBufferService
  ],
  exports: [
    PrismaService,
    CompanyContextService,
    RequestContextService,
    DatastoreRegistryService,
    TenantDatasourceRouterService,
    AiEventBufferService
  ]
})
export class PrismaModule {}
