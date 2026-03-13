import { Body, Controller, Delete, Get, Headers, Param, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { EntitlementsService } from './entitlements.service';
import { AuditService } from '../audit/audit.service';

@Controller('platform')
export class EntitlementsController {
  constructor(
    private readonly entitlementsService: EntitlementsService,
    private readonly auditService: AuditService
  ) {}

  @Roles('admin')
  @Get('entitlements/current')
  getCurrent(
    @Req()
    req: {
      user?: { company_id?: string };
      companyId?: string;
    }
  ) {
    return this.entitlementsService.getCurrent(this.requireCompanyId(req));
  }

  @Roles('admin')
  @Post('entitlements/sync')
  async sync(
    @Req()
    req: {
      clientId?: string;
      user?: { sub?: string; company_id?: string };
      companyId?: string;
    }
  ) {
    const clientId = req.clientId ?? process.env.DEFAULT_CLIENT_ID?.trim();
    if (!clientId) {
      throw new UnauthorizedException('Tenant client id is required for entitlement sync');
    }
    const companyId = this.requireCompanyId(req);
    try {
      const result = await this.entitlementsService.syncFromControlPlane(clientId, companyId);
      await this.auditService.record({
        companyId: result.entitlement.companyId,
        userId: req.user?.sub ?? null,
        action: 'PLATFORM_ENTITLEMENT_SYNC',
        entity: 'CompanyEntitlement',
        entityId: result.entitlement.companyId,
        metadata: {
          source: result.gateway.source,
          stale: result.gateway.stale,
          duplicate: result.duplicate,
          updated: result.updated,
          clientId
        }
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      await this.auditService.record({
        companyId,
        userId: req.user?.sub ?? null,
        action: 'PLATFORM_ENTITLEMENT_SYNC_FAILED',
        entity: 'CompanyEntitlement',
        entityId: companyId,
        metadata: {
          clientId,
          error: message
        }
      });
      throw error;
    }
  }

  @Public()
  @Post('webhooks/subscription')
  async webhook(
    @Headers('x-subman-signature') signature: string | undefined,
    @Body() payload: Record<string, unknown>
  ) {
    const result = await this.entitlementsService.applyWebhook(payload, signature);
    await this.auditService.record({
      companyId: result.entitlement.companyId,
      action: 'PLATFORM_ENTITLEMENT_WEBHOOK',
      entity: 'CompanyEntitlementEvent',
      entityId: String(payload.event_id ?? result.entitlement.companyId),
      metadata: {
        eventType: payload.event_type ?? 'subscription.updated',
        clientId: payload.client_id ?? result.entitlement.externalClientId,
        duplicate: result.duplicate,
        updated: result.updated
      }
    });
    return result;
  }

  @Public()
  @Post('tenants/provision')
  async provision(
    @Headers('x-platform-api-key') apiKey: string | undefined,
    @Body()
    payload: {
      client_id: string;
      company_name: string;
      company_code?: string;
      template?: 'SINGLE_STORE' | 'STORE_WAREHOUSE' | 'MULTI_BRANCH_STARTER' | 'MULTI_STORE';
      bootstrap_defaults?: boolean;
      tenancy_mode?: 'SHARED_DB' | 'DEDICATED_DB';
      datastore_ref?: string;
      plan_code?: string;
      status?: 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';
      features?: Record<string, unknown>;
      grace_until?: string | null;
      admin_email?: string;
      admin_password?: string;
    }
  ) {
    this.assertPlatformProvisionKey(apiKey);
    const result = await this.entitlementsService.provisionTenant(payload);
    await this.auditService.record({
      companyId: result.company_id,
      action: 'PLATFORM_TENANT_PROVISION',
      entity: 'Company',
      entityId: result.company_id,
      metadata: {
        clientId: result.client_id,
        template: result.template,
        created: result.created,
        tenancy_mode: result.tenancy_mode,
        datastore_ref: result.datastore_ref,
        datastore_migration_state: result.datastore_migration_state
      }
    });
    return result;
  }

  @Roles('platform_owner')
  @Get('owner/tenants')
  listTenants() {
    return this.entitlementsService.listTenantsForOwner();
  }

  @Roles('platform_owner')
  @Get('owner/tenants/datastore-health')
  async listTenantDatastoreHealth(
    @Req()
    req: {
      user?: { sub?: string; company_id?: string };
      companyId?: string;
    },
    @Query('strict') strictRaw?: string
  ) {
    const strict = ['1', 'true', 'yes'].includes(String(strictRaw ?? '').trim().toLowerCase());
    const result = await this.entitlementsService.listTenantDatastoreHealth(strict);
    await this.auditService.record({
      companyId: this.requireCompanyId(req),
      userId: req.user?.sub ?? null,
      action: 'PLATFORM_TENANT_DATASTORE_HEALTH_CHECK',
      entity: 'Company',
      metadata: {
        strict,
        totals: result.totals
      }
    });
    return result;
  }

  @Roles('platform_owner')
  @Post('owner/tenants/:companyId/migration/dry-run')
  async dryRunTenantMigration(
    @Req()
    req: {
      user?: { sub?: string; company_id?: string };
      companyId?: string;
    },
    @Param('companyId') companyId: string,
    @Body()
    payload: {
      target_mode?: 'SHARED_DB' | 'DEDICATED_DB';
      datastore_ref?: string;
      strict?: boolean;
    }
  ) {
    const result = await this.entitlementsService.ownerDryRunTenantMigration(companyId, payload);
    await this.auditService.record({
      companyId: this.requireCompanyId(req),
      userId: req.user?.sub ?? null,
      action: 'PLATFORM_TENANT_MIGRATION_DRY_RUN',
      entity: 'Company',
      entityId: companyId,
      metadata: {
        target_mode: result.target_mode,
        source_mode: result.source_mode,
        target_datastore_ref: result.target_datastore_ref,
        source_available: result.source_available,
        target_available: result.target_available,
        mismatch_count: result.totals.mismatch_count,
        unknown_count: result.totals.unknown_count,
        blocking_risks: result.blocking_risk_flags.length
      }
    });
    return result;
  }

  @Roles('platform_owner')
  @Post('owner/tenants/:companyId/migration/cutover')
  async executeTenantMigrationCutover(
    @Req()
    req: {
      user?: { sub?: string; company_id?: string };
      companyId?: string;
    },
    @Param('companyId') companyId: string,
    @Body()
    payload: {
      target_mode: 'SHARED_DB' | 'DEDICATED_DB';
      datastore_ref?: string;
      strict?: boolean;
      reason?: string;
    }
  ) {
    const result = await this.entitlementsService.ownerExecuteTenantCutover(companyId, payload);
    await this.auditService.record({
      companyId: this.requireCompanyId(req),
      userId: req.user?.sub ?? null,
      action: 'PLATFORM_TENANT_MIGRATION_CUTOVER',
      entity: 'Company',
      entityId: companyId,
      metadata: {
        from_mode: result.from_mode,
        to_mode: result.to_mode,
        from_datastore_ref: result.from_datastore_ref,
        to_datastore_ref: result.to_datastore_ref,
        rows_upserted: result.copy_stats.rows_upserted,
        mismatch_count: result.reconcile.mismatch_count,
        unknown_count: result.reconcile.unknown_count,
        blocking_risks: result.reconcile.blocking_risks
      }
    });
    return result;
  }

  @Roles('platform_owner')
  @Post('owner/tenants/:companyId/migration/rollback')
  async executeTenantMigrationRollback(
    @Req()
    req: {
      user?: { sub?: string; company_id?: string };
      companyId?: string;
    },
    @Param('companyId') companyId: string,
    @Body()
    payload: {
      strict?: boolean;
      reason?: string;
      target_mode?: 'SHARED_DB' | 'DEDICATED_DB';
      datastore_ref?: string;
    }
  ) {
    const result = await this.entitlementsService.ownerExecuteTenantRollback(companyId, payload);
    await this.auditService.record({
      companyId: this.requireCompanyId(req),
      userId: req.user?.sub ?? null,
      action: 'PLATFORM_TENANT_MIGRATION_ROLLBACK',
      entity: 'Company',
      entityId: companyId,
      metadata: {
        from_mode: result.from_mode,
        to_mode: result.to_mode,
        from_datastore_ref: result.from_datastore_ref,
        to_datastore_ref: result.to_datastore_ref,
        rows_upserted: result.copy_stats.rows_upserted,
        mismatch_count: result.reconcile.mismatch_count,
        unknown_count: result.reconcile.unknown_count,
        blocking_risks: result.reconcile.blocking_risks
      }
    });
    return result;
  }

  @Roles('platform_owner')
  @Post('owner/subscriptions/active')
  async listActiveSubscriptions(
    @Req()
    req: {
      user?: { sub?: string; company_id?: string };
      companyId?: string;
    },
    @Body()
    payload: {
      subman_api_key?: string;
    }
  ) {
    const subscriptions = await this.entitlementsService.listActiveSubscriptionsForOwner(payload);
    await this.auditService.record({
      companyId: this.requireCompanyId(req),
      userId: req.user?.sub ?? null,
      action: 'PLATFORM_SUBSCRIPTION_ACTIVE_LIST',
      entity: 'Subscription',
      metadata: {
        count: subscriptions.length
      }
    });
    return subscriptions;
  }

  @Roles('platform_owner')
  @Post('owner/tenants/provision-from-subscription')
  async provisionFromSubscription(
    @Req()
    req: {
      user?: { sub?: string };
    },
    @Body()
    payload: {
      client_id: string;
      company_name?: string;
      company_code?: string;
      template?: 'SINGLE_STORE' | 'STORE_WAREHOUSE' | 'MULTI_BRANCH_STARTER' | 'MULTI_STORE';
      bootstrap_defaults?: boolean;
      tenancy_mode?: 'SHARED_DB' | 'DEDICATED_DB';
      datastore_ref?: string;
      subman_api_key?: string;
      admin_email?: string;
      admin_password?: string;
    }
  ) {
    const result = await this.entitlementsService.provisionTenantFromSubscription(payload);
    await this.auditService.record({
      companyId: result.company_id,
      userId: req.user?.sub ?? null,
      action: 'PLATFORM_TENANT_PROVISION_FROM_SUBSCRIPTION',
      entity: 'Company',
      entityId: result.company_id,
      metadata: {
        clientId: result.client_id,
        created: result.created,
        source: result.subscription_source,
        tenancy_mode: result.tenancy_mode,
        datastore_ref: result.datastore_ref,
        datastore_migration_state: result.datastore_migration_state
      }
    });
    return result;
  }

  @Roles('platform_owner')
  @Post('owner/tenants/:companyId/override')
  async overrideTenantEntitlement(
    @Req()
    req: {
      user?: { sub?: string };
    },
    @Param('companyId') companyId: string,
    @Body()
    payload: {
      status?: 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';
      max_branches?: number;
      branch_mode?: 'SINGLE' | 'MULTI';
      inventory_mode?: 'STORE_ONLY' | 'STORE_WAREHOUSE';
      allow_delivery?: boolean;
      allow_transfers?: boolean;
      allow_mobile?: boolean;
      grace_until?: string | null;
      reason?: string;
    }
  ) {
    const entitlement = await this.entitlementsService.ownerOverrideEntitlement(companyId, {
      ...payload,
      actor_id: req.user?.sub ?? null
    });

    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'PLATFORM_TENANT_OVERRIDE',
      entity: 'CompanyEntitlement',
      entityId: companyId,
      metadata: {
        reason: payload.reason ?? null,
        status: entitlement.status,
        maxBranches: entitlement.maxBranches,
        branchMode: entitlement.branchMode,
        inventoryMode: entitlement.inventoryMode
      }
    });

    return { entitlement };
  }

  @Roles('platform_owner')
  @Post('owner/tenants/:companyId/suspend')
  async suspendTenant(
    @Req()
    req: {
      user?: { sub?: string };
    },
    @Param('companyId') companyId: string,
    @Body()
    payload: {
      grace_until?: string | null;
      reason?: string;
    }
  ) {
    const entitlement = await this.entitlementsService.ownerOverrideEntitlement(companyId, {
      status: 'SUSPENDED',
      grace_until: payload.grace_until,
      reason: payload.reason,
      actor_id: req.user?.sub ?? null
    });

    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'PLATFORM_TENANT_SUSPEND',
      entity: 'CompanyEntitlement',
      entityId: companyId,
      metadata: {
        reason: payload.reason ?? null,
        graceUntil: entitlement.graceUntil
      }
    });

    return { entitlement };
  }

  @Roles('platform_owner')
  @Post('owner/tenants/:companyId/reactivate')
  async reactivateTenant(
    @Req()
    req: {
      user?: { sub?: string };
    },
    @Param('companyId') companyId: string,
    @Body()
    payload: {
      reason?: string;
    }
  ) {
    const entitlement = await this.entitlementsService.ownerOverrideEntitlement(companyId, {
      status: 'ACTIVE',
      grace_until: null,
      reason: payload.reason,
      actor_id: req.user?.sub ?? null
    });

    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'PLATFORM_TENANT_REACTIVATE',
      entity: 'CompanyEntitlement',
      entityId: companyId,
      metadata: {
        reason: payload.reason ?? null
      }
    });

    return { entitlement };
  }

  @Roles('platform_owner')
  @Delete('owner/tenants/:companyId')
  async deleteTenant(
    @Req()
    req: {
      user?: { sub?: string; company_id?: string };
      companyId?: string;
    },
    @Param('companyId') companyId: string,
    @Body()
    payload: {
      reason?: string;
    }
  ) {
    const actorCompanyId = this.requireCompanyId(req);
    const result = await this.entitlementsService.ownerDeleteTenant(companyId, {
      reason: payload.reason,
      actor_id: req.user?.sub ?? null,
      actor_company_id: actorCompanyId
    });

    await this.auditService.record({
      companyId: actorCompanyId,
      userId: req.user?.sub ?? null,
      action: 'PLATFORM_TENANT_DELETE',
      entity: 'Company',
      entityId: result.company_id,
      metadata: {
        reason: payload.reason ?? null,
        target_company_code: result.company_code,
        target_company_name: result.company_name,
        target_client_id: result.client_id,
        tenancy_mode: result.tenancy_mode,
        datastore_ref: result.datastore_ref,
        dedicated_database_dropped: result.dedicated_database_dropped
      }
    });

    return result;
  }

  private requireCompanyId(req: { user?: { company_id?: string }; companyId?: string }): string {
    const companyId = req.user?.company_id ?? req.companyId;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }

  private assertPlatformProvisionKey(apiKey: string | undefined): void {
    const configured = process.env.PLATFORM_PROVISION_API_KEY?.trim();
    if (!configured) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('Platform provision key is not configured');
      }
      return;
    }

    if (!apiKey || apiKey.trim() !== configured) {
      throw new UnauthorizedException('Invalid platform provision key');
    }
  }
}
