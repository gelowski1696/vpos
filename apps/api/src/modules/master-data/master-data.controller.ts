import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, UnauthorizedException } from '@nestjs/common';
import { Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreatePriceList, MasterDataService } from './master-data.service';
import { AuditService } from '../audit/audit.service';

type PrimitivePayload = Record<string, unknown>;
type RequestWithTenant = Request & {
  user?: { sub?: string; company_id?: string; roles?: string[] };
  companyId?: string;
};

@Controller('master-data')
@Roles('admin', 'owner')
export class MasterDataController {
  constructor(
    private readonly masterDataService: MasterDataService,
    private readonly auditService: AuditService
  ) {}

  @Get('branches')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  listBranches(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string
  ): ReturnType<MasterDataService['listBranches']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    return this.masterDataService.listBranches(targetCompanyId);
  }

  @Get('branches/code-exists')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  async branchCodeExists(
    @Req() req: RequestWithTenant,
    @Query('code') code?: string,
    @Query('excludeId') excludeId?: string,
    @Query('companyId') companyId?: string
  ): Promise<{ exists: boolean }> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const exists = await this.masterDataService.branchCodeExists(
      String(code ?? ''),
      targetCompanyId,
      excludeId
    );
    return { exists };
  }

  @Post('branches')
  @Roles('owner', 'platform_owner')
  async createBranch(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['createBranch']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.createBranch({
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      type: body.type === 'WAREHOUSE' ? 'WAREHOUSE' : 'STORE',
      isActive: body.isActive === undefined ? true : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_BRANCH_CREATE', 'Branch', row.id, {
      code: row.code,
      type: row.type
    }, targetCompanyId);
    return row;
  }

  @Put('branches/:id')
  @Roles('owner', 'platform_owner')
  async updateBranch(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updateBranch']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.updateBranch(id, {
      code: body.code === undefined ? undefined : String(body.code),
      name: body.name === undefined ? undefined : String(body.name),
      type: body.type === 'STORE' || body.type === 'WAREHOUSE' ? body.type : undefined,
      isActive: body.isActive === undefined ? undefined : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_BRANCH_UPDATE', 'Branch', row.id, {
      code: row.code,
      type: row.type
    }, targetCompanyId);
    return row;
  }

  @Delete('branches/:id')
  @Roles('owner', 'platform_owner')
  async deleteBranch(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['safeDeleteBranch']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.safeDeleteBranch(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_BRANCH_SAFE_DELETE', 'Branch', row.id, {
      code: row.code,
      isActive: row.isActive,
      cascadeLocations: true
    }, targetCompanyId);
    return row;
  }

  @Delete('branches/:id/permanent')
  @Roles('platform_owner')
  async hardDeleteBranch(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['hardDeleteBranch']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.hardDeleteBranch(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_BRANCH_HARD_DELETE', 'Branch', row.id, {
      code: row.code,
      permanent: true
    }, targetCompanyId);
    return row;
  }

  @Get('locations')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  listLocations(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string
  ): ReturnType<MasterDataService['listLocations']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    return this.masterDataService.listLocations(targetCompanyId);
  }

  @Post('locations')
  @Roles('owner', 'platform_owner')
  async createLocation(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['createLocation']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const validType =
      body.type === 'BRANCH_STORE' ||
      body.type === 'BRANCH_WAREHOUSE' ||
      body.type === 'TRUCK' ||
      body.type === 'PERSONNEL'
        ? body.type
        : 'BRANCH_STORE';

    const row = await this.masterDataService.createLocation({
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      type: validType,
      branchId: body.branchId ? String(body.branchId) : null,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_LOCATION_CREATE', 'Location', row.id, {
      code: row.code,
      type: row.type
    }, targetCompanyId);
    return row;
  }

  @Put('locations/:id')
  @Roles('owner', 'platform_owner')
  async updateLocation(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updateLocation']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const validType =
      body.type === 'BRANCH_STORE' ||
      body.type === 'BRANCH_WAREHOUSE' ||
      body.type === 'TRUCK' ||
      body.type === 'PERSONNEL'
        ? body.type
        : undefined;

    const row = await this.masterDataService.updateLocation(id, {
      code: body.code === undefined ? undefined : String(body.code),
      name: body.name === undefined ? undefined : String(body.name),
      type: validType,
      branchId: body.branchId === undefined ? undefined : body.branchId ? String(body.branchId) : null,
      isActive: body.isActive === undefined ? undefined : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_LOCATION_UPDATE', 'Location', row.id, {
      code: row.code,
      type: row.type
    }, targetCompanyId);
    return row;
  }

  @Delete('locations/:id')
  @Roles('owner', 'platform_owner')
  async deleteLocation(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['safeDeleteLocation']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.safeDeleteLocation(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_LOCATION_SAFE_DELETE', 'Location', row.id, {
      code: row.code,
      isActive: row.isActive
    }, targetCompanyId);
    return row;
  }

  @Delete('locations/:id/permanent')
  @Roles('platform_owner')
  async hardDeleteLocation(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['hardDeleteLocation']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.hardDeleteLocation(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_LOCATION_HARD_DELETE', 'Location', row.id, {
      code: row.code,
      permanent: true
    }, targetCompanyId);
    return row;
  }

  @Get('users')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  listUsers(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string
  ): ReturnType<MasterDataService['listUsers']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    return this.masterDataService.listUsers(targetCompanyId);
  }

  @Get('users/email-exists')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  async userEmailExists(
    @Req() req: RequestWithTenant,
    @Query('email') email?: string,
    @Query('excludeUserId') excludeUserId?: string,
    @Query('companyId') companyId?: string
  ): Promise<{ exists: boolean }> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const exists = await this.masterDataService.userEmailExists(
      String(email ?? ''),
      targetCompanyId,
      excludeUserId
    );
    return { exists };
  }

  @Post('users')
  @Roles('owner', 'platform_owner')
  async createUser(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['createUser']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.createUser({
      email: String(body.email ?? ''),
      fullName: String(body.fullName ?? ''),
      roles: this.parseRoles(body.roles),
      password: body.password === undefined ? undefined : String(body.password),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_USER_CREATE', 'User', row.id, {
      email: row.email,
      roleCount: row.roles.length
    }, targetCompanyId);
    return row;
  }

  @Put('users/:id')
  @Roles('owner', 'platform_owner')
  async updateUser(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updateUser']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.updateUser(id, {
      email: body.email === undefined ? undefined : String(body.email),
      fullName: body.fullName === undefined ? undefined : String(body.fullName),
      roles: body.roles === undefined ? undefined : this.parseRoles(body.roles),
      password: body.password === undefined ? undefined : String(body.password),
      isActive: body.isActive === undefined ? undefined : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_USER_UPDATE', 'User', row.id, {
      email: row.email,
      roleCount: row.roles.length
    }, targetCompanyId);
    return row;
  }

  @Delete('users/:id')
  @Roles('owner', 'platform_owner')
  async deleteUser(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['safeDeleteUser']>> {
    if (req.user?.sub && req.user.sub === id) {
      throw new ForbiddenException('You cannot delete your own account');
    }
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.safeDeleteUser(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_USER_SAFE_DELETE', 'User', row.id, {
      email: row.email,
      isActive: row.isActive
    }, targetCompanyId);
    return row;
  }

  @Delete('users/:id/permanent')
  @Roles('platform_owner')
  async hardDeleteUser(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['hardDeleteUser']>> {
    if (req.user?.sub && req.user.sub === id) {
      throw new ForbiddenException('You cannot permanently delete your own account');
    }
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.hardDeleteUser(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_USER_HARD_DELETE', 'User', row.id, {
      email: row.email,
      permanent: true
    }, targetCompanyId);
    return row;
  }

  @Get('personnel-roles')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  listPersonnelRoles(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string
  ): ReturnType<MasterDataService['listPersonnelRoles']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    return this.masterDataService.listPersonnelRoles(targetCompanyId);
  }

  @Get('personnel-roles/code-exists')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  async personnelRoleCodeExists(
    @Req() req: RequestWithTenant,
    @Query('code') code?: string,
    @Query('excludeId') excludeId?: string,
    @Query('companyId') companyId?: string
  ): Promise<{ exists: boolean }> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const exists = await this.masterDataService.personnelRoleCodeExists(
      String(code ?? ''),
      targetCompanyId,
      excludeId
    );
    return { exists };
  }

  @Post('personnel-roles')
  @Roles('admin', 'owner', 'platform_owner')
  async createPersonnelRole(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['createPersonnelRole']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.createPersonnelRole(
      {
        code: String(body.code ?? ''),
        name: String(body.name ?? ''),
        isActive: body.isActive === undefined ? true : Boolean(body.isActive)
      },
      targetCompanyId
    );
    await this.auditWrite(req, 'MASTER_DATA_PERSONNEL_ROLE_CREATE', 'PersonnelRole', row.id, {
      code: row.code
    }, targetCompanyId);
    return row;
  }

  @Put('personnel-roles/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async updatePersonnelRole(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updatePersonnelRole']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.updatePersonnelRole(
      id,
      {
        code: body.code === undefined ? undefined : String(body.code),
        name: body.name === undefined ? undefined : String(body.name),
        isActive: body.isActive === undefined ? undefined : Boolean(body.isActive)
      },
      targetCompanyId
    );
    await this.auditWrite(req, 'MASTER_DATA_PERSONNEL_ROLE_UPDATE', 'PersonnelRole', row.id, {
      code: row.code
    }, targetCompanyId);
    return row;
  }

  @Delete('personnel-roles/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async deletePersonnelRole(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['safeDeletePersonnelRole']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.safeDeletePersonnelRole(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_PERSONNEL_ROLE_SAFE_DELETE', 'PersonnelRole', row.id, {
      code: row.code,
      isActive: row.isActive
    }, targetCompanyId);
    return row;
  }

  @Get('personnels')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  listPersonnels(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string
  ): ReturnType<MasterDataService['listPersonnel']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    return this.masterDataService.listPersonnel(targetCompanyId);
  }

  @Get('personnels/code-exists')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  async personnelCodeExists(
    @Req() req: RequestWithTenant,
    @Query('code') code?: string,
    @Query('excludeId') excludeId?: string,
    @Query('companyId') companyId?: string
  ): Promise<{ exists: boolean }> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const exists = await this.masterDataService.personnelCodeExists(
      String(code ?? ''),
      targetCompanyId,
      excludeId
    );
    return { exists };
  }

  @Post('personnels')
  @Roles('admin', 'owner', 'platform_owner')
  async createPersonnel(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['createPersonnel']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.createPersonnel(
      {
        code: String(body.code ?? ''),
        fullName: String(body.fullName ?? body.name ?? ''),
        branchId: String(body.branchId ?? body.branch_id ?? ''),
        roleId: String(body.roleId ?? body.role_id ?? ''),
        phone: body.phone ? String(body.phone) : null,
        email: body.email ? String(body.email) : null,
        isActive: body.isActive === undefined ? true : Boolean(body.isActive)
      },
      targetCompanyId
    );
    await this.auditWrite(req, 'MASTER_DATA_PERSONNEL_CREATE', 'Personnel', row.id, {
      code: row.code,
      branchId: row.branchId,
      roleId: row.roleId
    }, targetCompanyId);
    return row;
  }

  @Put('personnels/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async updatePersonnel(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updatePersonnel']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.updatePersonnel(
      id,
      {
        code: body.code === undefined ? undefined : String(body.code),
        fullName: body.fullName === undefined && body.name === undefined ? undefined : String(body.fullName ?? body.name),
        branchId:
          body.branchId === undefined && body.branch_id === undefined
            ? undefined
            : String(body.branchId ?? body.branch_id ?? ''),
        roleId:
          body.roleId === undefined && body.role_id === undefined
            ? undefined
            : String(body.roleId ?? body.role_id ?? ''),
        phone: body.phone === undefined ? undefined : body.phone ? String(body.phone) : null,
        email: body.email === undefined ? undefined : body.email ? String(body.email) : null,
        isActive: body.isActive === undefined ? undefined : Boolean(body.isActive)
      },
      targetCompanyId
    );
    await this.auditWrite(req, 'MASTER_DATA_PERSONNEL_UPDATE', 'Personnel', row.id, {
      code: row.code,
      branchId: row.branchId,
      roleId: row.roleId
    }, targetCompanyId);
    return row;
  }

  @Delete('personnels/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async deletePersonnel(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['safeDeletePersonnel']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.safeDeletePersonnel(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_PERSONNEL_SAFE_DELETE', 'Personnel', row.id, {
      code: row.code,
      isActive: row.isActive
    }, targetCompanyId);
    return row;
  }

  @Post('import/personnels/validate')
  @Roles('admin', 'owner', 'platform_owner')
  validatePersonnelImport(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): ReturnType<MasterDataService['validatePersonnelImport']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    return this.masterDataService.validatePersonnelImport(
      this.parseImportRows(body.rows),
      targetCompanyId
    );
  }

  @Post('import/personnels/commit')
  @Roles('admin', 'owner', 'platform_owner')
  async commitPersonnelImport(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['commitPersonnelImport']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const result = await this.masterDataService.commitPersonnelImport(
      this.parseImportRows(body.rows),
      {
        skipInvalid: body.skipInvalid === undefined ? true : Boolean(body.skipInvalid)
      },
      targetCompanyId
    );
    await this.auditWrite(req, 'MASTER_DATA_PERSONNEL_IMPORT_COMMIT', 'Personnel', undefined, {
      created: result.created,
      updated: result.updated,
      failed: result.failed,
      skipped: result.skipped
    }, targetCompanyId);
    return result;
  }

  @Get('customers')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  listCustomers(
    @Req() req: RequestWithTenant,
    @Query('include_balance') includeBalance?: string,
    @Query('branch_id') branchId?: string,
    @Query('companyId') companyId?: string
  ): ReturnType<MasterDataService['listCustomers']> {
    const withBalance = includeBalance === '1' || includeBalance === 'true';
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    return this.masterDataService.listCustomers({
      includeBalance: withBalance,
      branchId: branchId?.trim() || null,
      companyId: targetCompanyId
    });
  }

  @Get('customers/code-exists')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  async customerCodeExists(
    @Req() req: RequestWithTenant,
    @Query('code') code?: string,
    @Query('excludeId') excludeId?: string,
    @Query('companyId') companyId?: string
  ): Promise<{ exists: boolean }> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const exists = await this.masterDataService.customerCodeExists(
      String(code ?? ''),
      targetCompanyId,
      excludeId
    );
    return { exists };
  }

  @Post('customers')
  async createCustomer(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['createCustomer']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const type = body.type === 'BUSINESS' ? 'BUSINESS' : 'RETAIL';
    const row = await this.masterDataService.createCustomer({
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      type,
      tier: body.tier ? String(body.tier) : null,
      contractPrice: this.toNumber(body.contractPrice),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_CUSTOMER_CREATE', 'Customer', row.id, {
      code: row.code,
      type: row.type
    }, targetCompanyId);
    return row;
  }

  @Put('customers/:id')
  async updateCustomer(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updateCustomer']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const type = body.type === 'BUSINESS' || body.type === 'RETAIL' ? body.type : undefined;
    const row = await this.masterDataService.updateCustomer(id, {
      code: body.code === undefined ? undefined : String(body.code),
      name: body.name === undefined ? undefined : String(body.name),
      type,
      tier: body.tier === undefined ? undefined : body.tier ? String(body.tier) : null,
      contractPrice: body.contractPrice === undefined ? undefined : this.toNumber(body.contractPrice),
      isActive: body.isActive === undefined ? undefined : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_CUSTOMER_UPDATE', 'Customer', row.id, {
      code: row.code,
      type: row.type
    }, targetCompanyId);
    return row;
  }

  @Delete('customers/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async deleteCustomer(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['safeDeleteCustomer']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.safeDeleteCustomer(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_CUSTOMER_SAFE_DELETE', 'Customer', row.id, {
      code: row.code,
      isActive: row.isActive
    }, targetCompanyId);
    return row;
  }

  @Get('suppliers')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  listSuppliers(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string
  ): ReturnType<MasterDataService['listSuppliers']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    return this.masterDataService.listSuppliers(targetCompanyId);
  }

  @Get('suppliers/code-exists')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  async supplierCodeExists(
    @Req() req: RequestWithTenant,
    @Query('code') code?: string,
    @Query('excludeId') excludeId?: string,
    @Query('companyId') companyId?: string
  ): Promise<{ exists: boolean }> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const exists = await this.masterDataService.supplierCodeExists(
      String(code ?? ''),
      targetCompanyId,
      excludeId
    );
    return { exists };
  }

  @Post('suppliers')
  @Roles('admin', 'owner', 'platform_owner')
  async createSupplier(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['createSupplier']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.createSupplier(
      {
        code: String(body.code ?? ''),
        name: String(body.name ?? ''),
        locationId: body.locationId ? String(body.locationId) : null,
        contactPerson: body.contactPerson ? String(body.contactPerson) : null,
        phone: body.phone ? String(body.phone) : null,
        email: body.email ? String(body.email) : null,
        address: body.address ? String(body.address) : null,
        isActive: body.isActive === undefined ? true : Boolean(body.isActive)
      },
      targetCompanyId
    );
    await this.auditWrite(req, 'MASTER_DATA_SUPPLIER_CREATE', 'Supplier', row.id, {
      code: row.code
    }, targetCompanyId);
    return row;
  }

  @Put('suppliers/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async updateSupplier(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updateSupplier']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.updateSupplier(
      id,
      {
        code: body.code === undefined ? undefined : String(body.code),
        name: body.name === undefined ? undefined : String(body.name),
        locationId:
          body.locationId === undefined ? undefined : body.locationId ? String(body.locationId) : null,
        contactPerson:
          body.contactPerson === undefined
            ? undefined
            : body.contactPerson
              ? String(body.contactPerson)
              : null,
        phone: body.phone === undefined ? undefined : body.phone ? String(body.phone) : null,
        email: body.email === undefined ? undefined : body.email ? String(body.email) : null,
        address: body.address === undefined ? undefined : body.address ? String(body.address) : null,
        isActive: body.isActive === undefined ? undefined : Boolean(body.isActive)
      },
      targetCompanyId
    );
    await this.auditWrite(req, 'MASTER_DATA_SUPPLIER_UPDATE', 'Supplier', row.id, {
      code: row.code
    }, targetCompanyId);
    return row;
  }

  @Delete('suppliers/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async deleteSupplier(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['safeDeleteSupplier']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.safeDeleteSupplier(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_SUPPLIER_SAFE_DELETE', 'Supplier', row.id, {
      code: row.code,
      isActive: row.isActive
    }, targetCompanyId);
    return row;
  }

  @Post('import/suppliers/validate')
  @Roles('admin', 'owner', 'platform_owner')
  validateSupplierImport(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): ReturnType<MasterDataService['validateSupplierImport']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    return this.masterDataService.validateSupplierImport(
      this.parseImportRows(body.rows),
      targetCompanyId
    );
  }

  @Post('import/suppliers/commit')
  @Roles('admin', 'owner', 'platform_owner')
  async commitSupplierImport(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['commitSupplierImport']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const result = await this.masterDataService.commitSupplierImport(
      this.parseImportRows(body.rows),
      {
        skipInvalid: body.skipInvalid === undefined ? true : Boolean(body.skipInvalid)
      },
      targetCompanyId
    );
    await this.auditWrite(req, 'MASTER_DATA_SUPPLIER_IMPORT_COMMIT', 'Supplier', undefined, {
      created: result.created,
      updated: result.updated,
      failed: result.failed,
      skipped: result.skipped
    }, targetCompanyId);
    return result;
  }

  @Post('import/customers/validate')
  @Roles('admin', 'owner', 'platform_owner')
  validateCustomerImport(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): ReturnType<MasterDataService['validateCustomerImport']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    return this.masterDataService.validateCustomerImport(
      this.parseImportRows(body.rows),
      targetCompanyId
    );
  }

  @Post('import/customers/commit')
  @Roles('admin', 'owner', 'platform_owner')
  async commitCustomerImport(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['commitCustomerImport']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const result = await this.masterDataService.commitCustomerImport(
      this.parseImportRows(body.rows),
      {
        skipInvalid: body.skipInvalid === undefined ? true : Boolean(body.skipInvalid)
      },
      targetCompanyId
    );
    await this.auditWrite(req, 'MASTER_DATA_CUSTOMER_IMPORT_COMMIT', 'Customer', undefined, {
      created: result.created,
      updated: result.updated,
      failed: result.failed,
      skipped: result.skipped
    }, targetCompanyId);
    return result;
  }

  @Get('cylinder-types')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  listCylinderTypes(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string
  ): ReturnType<MasterDataService['listCylinderTypes']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    return this.masterDataService.listCylinderTypes(targetCompanyId);
  }

  @Get('cylinder-types/code-exists')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  async cylinderTypeCodeExists(
    @Req() req: RequestWithTenant,
    @Query('code') code?: string,
    @Query('excludeId') excludeId?: string,
    @Query('companyId') companyId?: string
  ): Promise<{ exists: boolean }> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const exists = await this.masterDataService.cylinderTypeCodeExists(
      String(code ?? ''),
      targetCompanyId,
      excludeId
    );
    return { exists };
  }

  @Post('cylinder-types')
  @Roles('admin', 'owner', 'platform_owner')
  async createCylinderType(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['createCylinderType']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.createCylinderType({
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      sizeKg: Number(body.sizeKg ?? 0),
      depositAmount: Number(body.depositAmount ?? 0),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_CYLINDER_TYPE_CREATE', 'CylinderType', row.id, {
      code: row.code
    }, targetCompanyId);
    return row;
  }

  @Put('cylinder-types/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async updateCylinderType(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updateCylinderType']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.updateCylinderType(id, {
      code: body.code === undefined ? undefined : String(body.code),
      name: body.name === undefined ? undefined : String(body.name),
      sizeKg: body.sizeKg === undefined ? undefined : Number(body.sizeKg),
      depositAmount: body.depositAmount === undefined ? undefined : Number(body.depositAmount),
      isActive: body.isActive === undefined ? undefined : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_CYLINDER_TYPE_UPDATE', 'CylinderType', row.id, {
      code: row.code
    }, targetCompanyId);
    return row;
  }

  @Delete('cylinder-types/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async deleteCylinderType(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['safeDeleteCylinderType']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.safeDeleteCylinderType(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_CYLINDER_TYPE_SAFE_DELETE', 'CylinderType', row.id, {
      code: row.code,
      isActive: row.isActive
    }, targetCompanyId);
    return row;
  }

  @Post('import/cylinder-types/validate')
  @Roles('admin', 'owner', 'platform_owner')
  validateCylinderTypeImport(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): ReturnType<MasterDataService['validateCylinderTypeImport']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    return this.masterDataService.validateCylinderTypeImport(
      this.parseImportRows(body.rows),
      targetCompanyId
    );
  }

  @Post('import/cylinder-types/commit')
  @Roles('admin', 'owner', 'platform_owner')
  async commitCylinderTypeImport(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['commitCylinderTypeImport']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const result = await this.masterDataService.commitCylinderTypeImport(
      this.parseImportRows(body.rows),
      {
        skipInvalid: body.skipInvalid === undefined ? true : Boolean(body.skipInvalid)
      },
      targetCompanyId
    );
    await this.auditWrite(req, 'MASTER_DATA_CYLINDER_TYPE_IMPORT_COMMIT', 'CylinderType', undefined, {
      created: result.created,
      updated: result.updated,
      failed: result.failed,
      skipped: result.skipped
    }, targetCompanyId);
    return result;
  }

  @Get('products')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  listProducts(): ReturnType<MasterDataService['listProducts']> {
    return this.masterDataService.listProducts();
  }

  @Get('inventory/opening-stock')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  getInventoryOpeningSnapshot(): ReturnType<MasterDataService['getInventoryOpeningSnapshot']> {
    return this.masterDataService.getInventoryOpeningSnapshot();
  }

  @Post('inventory/opening-stock')
  @Roles('admin', 'owner', 'platform_owner')
  async applyInventoryOpening(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['applyInventoryOpening']>> {
    const row = await this.masterDataService.applyInventoryOpening({
      locationId: String(body.locationId ?? ''),
      productId: String(body.productId ?? ''),
      qtyOnHand: Number(body.qtyOnHand ?? 0),
      qtyFull: body.qtyFull === undefined ? undefined : Number(body.qtyFull),
      qtyEmpty: body.qtyEmpty === undefined ? undefined : Number(body.qtyEmpty),
      avgCost: Number(body.avgCost ?? 0),
      notes: body.notes === undefined ? undefined : body.notes === null ? null : String(body.notes),
      force: body.force === undefined ? false : Boolean(body.force)
    });
    await this.auditWrite(req, 'MASTER_DATA_OPENING_STOCK_APPLY', 'InventoryLedger', row.ledgerId, {
      locationId: row.locationId,
      productId: row.productId,
      qtyFull: row.qtyFull,
      qtyEmpty: row.qtyEmpty,
      qtyOnHand: row.qtyOnHand,
      avgCost: row.avgCost,
      qtyDelta: row.qtyDelta,
      referenceId: row.referenceId
    });
    return row;
  }

  @Get('costing-config')
  @Roles('admin', 'owner', 'platform_owner')
  getCostingConfig(): ReturnType<MasterDataService['getCostingConfig']> {
    return this.masterDataService.getCostingConfig();
  }

  @Put('costing-config')
  @Roles('admin', 'owner', 'platform_owner')
  async updateCostingConfig(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updateCostingConfig']>> {
    const row = await this.masterDataService.updateCostingConfig({
      method:
        body.method === 'WAC' ||
        body.method === 'STANDARD' ||
        body.method === 'LAST_PURCHASE' ||
        body.method === 'MANUAL_OVERRIDE'
          ? body.method
          : undefined,
      allowManualOverride:
        body.allowManualOverride === undefined ? undefined : Boolean(body.allowManualOverride),
      negativeStockPolicy:
        body.negativeStockPolicy === 'BLOCK_POSTING' ||
        body.negativeStockPolicy === 'ALLOW_WITH_REVIEW'
          ? body.negativeStockPolicy
          : undefined,
      includeFreight: body.includeFreight === undefined ? undefined : Boolean(body.includeFreight),
      includeHandling: body.includeHandling === undefined ? undefined : Boolean(body.includeHandling),
      includeOtherLandedCost:
        body.includeOtherLandedCost === undefined ? undefined : Boolean(body.includeOtherLandedCost),
      allocationBasis:
        body.allocationBasis === 'PER_QUANTITY' || body.allocationBasis === 'PER_WEIGHT'
          ? body.allocationBasis
          : undefined,
      roundingScale:
        body.roundingScale === undefined ? undefined : Number(body.roundingScale),
      locked: body.locked === undefined ? undefined : Boolean(body.locked)
    });
    await this.auditWrite(req, 'MASTER_DATA_COSTING_CONFIG_UPDATE', 'CostingConfig', undefined, {
      method: row.method,
      negativeStockPolicy: row.negativeStockPolicy,
      roundingScale: row.roundingScale
    });
    return row;
  }

  @Get('products/:id/cost-snapshot')
  getProductCostSnapshot(
    @Param('id') id: string
  ): ReturnType<MasterDataService['getProductCostSnapshot']> {
    return this.masterDataService.getProductCostSnapshot(id);
  }

  @Post('products')
  async createProduct(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['createProduct']>> {
    const row = await this.masterDataService.createProduct({
      sku: String(body.sku ?? ''),
      name: String(body.name ?? ''),
      category:
        body.category === undefined || body.category === null || body.category === ''
          ? null
          : String(body.category),
      brand:
        body.brand === undefined || body.brand === null || body.brand === ''
          ? null
          : String(body.brand),
      unit: String(body.unit ?? 'unit'),
      isLpg: body.isLpg === undefined ? false : Boolean(body.isLpg),
      cylinderTypeId: body.cylinderTypeId ? String(body.cylinderTypeId) : null,
      standardCost:
        body.standardCost === undefined || body.standardCost === null || body.standardCost === ''
          ? null
          : Number(body.standardCost),
      lowStockAlertQty:
        body.lowStockAlertQty === undefined || body.lowStockAlertQty === null || body.lowStockAlertQty === ''
          ? null
          : Number(body.lowStockAlertQty),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive)
    });
    await this.auditWrite(req, 'MASTER_DATA_PRODUCT_CREATE', 'Product', row.id, {
      sku: row.sku,
      isLpg: row.isLpg
    });
    return row;
  }

  @Put('products/:id')
  async updateProduct(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updateProduct']>> {
    const row = await this.masterDataService.updateProduct(id, {
      sku: body.sku === undefined ? undefined : String(body.sku),
      name: body.name === undefined ? undefined : String(body.name),
      category:
        body.category === undefined
          ? undefined
          : body.category === null || body.category === ''
            ? null
            : String(body.category),
      brand:
        body.brand === undefined
          ? undefined
          : body.brand === null || body.brand === ''
            ? null
            : String(body.brand),
      unit: body.unit === undefined ? undefined : String(body.unit),
      isLpg: body.isLpg === undefined ? undefined : Boolean(body.isLpg),
      cylinderTypeId: body.cylinderTypeId === undefined ? undefined : body.cylinderTypeId ? String(body.cylinderTypeId) : null,
      standardCost:
        body.standardCost === undefined
          ? undefined
          : body.standardCost === null || body.standardCost === ''
            ? null
            : Number(body.standardCost),
      lowStockAlertQty:
        body.lowStockAlertQty === undefined
          ? undefined
          : body.lowStockAlertQty === null || body.lowStockAlertQty === ''
            ? null
            : Number(body.lowStockAlertQty),
      isActive: body.isActive === undefined ? undefined : Boolean(body.isActive)
    });
    await this.auditWrite(req, 'MASTER_DATA_PRODUCT_UPDATE', 'Product', row.id, {
      sku: row.sku,
      isLpg: row.isLpg
    });
    return row;
  }

  @Delete('products/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async deleteProduct(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['safeDeleteProduct']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.safeDeleteProduct(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_PRODUCT_SAFE_DELETE', 'Product', row.id, {
      sku: row.sku,
      isActive: row.isActive
    }, targetCompanyId);
    return row;
  }

  @Post('import/products/validate')
  @Roles('admin', 'owner', 'platform_owner')
  validateProductImport(
    @Body() body: PrimitivePayload
  ): ReturnType<MasterDataService['validateProductImport']> {
    return this.masterDataService.validateProductImport(this.parseImportRows(body.rows));
  }

  @Post('import/products/commit')
  @Roles('admin', 'owner', 'platform_owner')
  async commitProductImport(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['commitProductImport']>> {
    const result = await this.masterDataService.commitProductImport(
      this.parseImportRows(body.rows),
      {
        skipInvalid: body.skipInvalid === undefined ? true : Boolean(body.skipInvalid)
      }
    );
    await this.auditWrite(req, 'MASTER_DATA_PRODUCT_IMPORT_COMMIT', 'Product', undefined, {
      created: result.created,
      updated: result.updated,
      failed: result.failed,
      skipped: result.skipped
    });
    return result;
  }

  @Get('expense-categories')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  listExpenseCategories(): ReturnType<MasterDataService['listExpenseCategories']> {
    return this.masterDataService.listExpenseCategories();
  }

  @Get('product-categories')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  listProductCategories(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string
  ): ReturnType<MasterDataService['listProductCategories']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    return this.masterDataService.listProductCategories(targetCompanyId);
  }

  @Get('product-categories/code-exists')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  async productCategoryCodeExists(
    @Req() req: RequestWithTenant,
    @Query('code') code?: string,
    @Query('excludeId') excludeId?: string,
    @Query('companyId') companyId?: string
  ): Promise<{ exists: boolean }> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const exists = await this.masterDataService.productCategoryCodeExists(
      String(code ?? ''),
      targetCompanyId,
      excludeId
    );
    return { exists };
  }

  @Post('product-categories')
  @Roles('admin', 'owner', 'platform_owner')
  async createProductCategory(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['createProductCategory']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.createProductCategory({
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_PRODUCT_CATEGORY_CREATE', 'ProductCategory', row.id, {
      code: row.code
    }, targetCompanyId);
    return row;
  }

  @Put('product-categories/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async updateProductCategory(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updateProductCategory']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.updateProductCategory(id, {
      code: body.code === undefined ? undefined : String(body.code),
      name: body.name === undefined ? undefined : String(body.name),
      isActive: body.isActive === undefined ? undefined : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_PRODUCT_CATEGORY_UPDATE', 'ProductCategory', row.id, {
      code: row.code
    }, targetCompanyId);
    return row;
  }

  @Delete('product-categories/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async deleteProductCategory(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['safeDeleteProductCategory']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.safeDeleteProductCategory(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_PRODUCT_CATEGORY_SAFE_DELETE', 'ProductCategory', row.id, {
      code: row.code,
      isActive: row.isActive
    }, targetCompanyId);
    return row;
  }

  @Post('import/product-categories/validate')
  @Roles('admin', 'owner', 'platform_owner')
  validateProductCategoryImport(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): ReturnType<MasterDataService['validateProductCategoryImport']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    return this.masterDataService.validateProductCategoryImport(
      this.parseImportRows(body.rows),
      targetCompanyId
    );
  }

  @Post('import/product-categories/commit')
  @Roles('admin', 'owner', 'platform_owner')
  async commitProductCategoryImport(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['commitProductCategoryImport']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const result = await this.masterDataService.commitProductCategoryImport(
      this.parseImportRows(body.rows),
      {
        skipInvalid: body.skipInvalid === undefined ? true : Boolean(body.skipInvalid)
      },
      targetCompanyId
    );
    await this.auditWrite(req, 'MASTER_DATA_PRODUCT_CATEGORY_IMPORT_COMMIT', 'ProductCategory', undefined, {
      created: result.created,
      updated: result.updated,
      failed: result.failed,
      skipped: result.skipped
    }, targetCompanyId);
    return result;
  }

  @Get('product-brands')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  listProductBrands(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string
  ): ReturnType<MasterDataService['listProductBrands']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    return this.masterDataService.listProductBrands(targetCompanyId);
  }

  @Post('product-brands')
  @Roles('admin', 'owner', 'platform_owner')
  async createProductBrand(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['createProductBrand']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.createProductBrand({
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_PRODUCT_BRAND_CREATE', 'ProductBrand', row.id, {
      code: row.code
    }, targetCompanyId);
    return row;
  }

  @Put('product-brands/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async updateProductBrand(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updateProductBrand']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const row = await this.masterDataService.updateProductBrand(id, {
      code: body.code === undefined ? undefined : String(body.code),
      name: body.name === undefined ? undefined : String(body.name),
      isActive: body.isActive === undefined ? undefined : Boolean(body.isActive)
    }, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_PRODUCT_BRAND_UPDATE', 'ProductBrand', row.id, {
      code: row.code
    }, targetCompanyId);
    return row;
  }

  @Delete('product-brands/:id')
  @Roles('admin', 'owner', 'platform_owner')
  async deleteProductBrand(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Query('companyId') companyId?: string
  ): Promise<ReturnType<MasterDataService['safeDeleteProductBrand']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    const row = await this.masterDataService.safeDeleteProductBrand(id, targetCompanyId);
    await this.auditWrite(req, 'MASTER_DATA_PRODUCT_BRAND_SAFE_DELETE', 'ProductBrand', row.id, {
      code: row.code,
      isActive: row.isActive
    }, targetCompanyId);
    return row;
  }

  @Post('import/product-brands/validate')
  @Roles('admin', 'owner', 'platform_owner')
  validateProductBrandImport(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): ReturnType<MasterDataService['validateProductBrandImport']> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    return this.masterDataService.validateProductBrandImport(
      this.parseImportRows(body.rows),
      targetCompanyId
    );
  }

  @Post('import/product-brands/commit')
  @Roles('admin', 'owner', 'platform_owner')
  async commitProductBrandImport(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['commitProductBrandImport']>> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    const result = await this.masterDataService.commitProductBrandImport(
      this.parseImportRows(body.rows),
      {
        skipInvalid: body.skipInvalid === undefined ? true : Boolean(body.skipInvalid)
      },
      targetCompanyId
    );
    await this.auditWrite(req, 'MASTER_DATA_PRODUCT_BRAND_IMPORT_COMMIT', 'ProductBrand', undefined, {
      created: result.created,
      updated: result.updated,
      failed: result.failed,
      skipped: result.skipped
    }, targetCompanyId);
    return result;
  }

  @Post('expense-categories')
  async createExpenseCategory(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['createExpenseCategory']>> {
    const row = await this.masterDataService.createExpenseCategory({
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive)
    });
    await this.auditWrite(req, 'MASTER_DATA_EXPENSE_CATEGORY_CREATE', 'ExpenseCategory', row.id, {
      code: row.code
    });
    return row;
  }

  @Put('expense-categories/:id')
  async updateExpenseCategory(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updateExpenseCategory']>> {
    const row = await this.masterDataService.updateExpenseCategory(id, {
      code: body.code === undefined ? undefined : String(body.code),
      name: body.name === undefined ? undefined : String(body.name),
      isActive: body.isActive === undefined ? undefined : Boolean(body.isActive)
    });
    await this.auditWrite(req, 'MASTER_DATA_EXPENSE_CATEGORY_UPDATE', 'ExpenseCategory', row.id, {
      code: row.code
    });
    return row;
  }

  @Get('price-lists')
  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  listPriceLists(): ReturnType<MasterDataService['listPriceLists']> {
    return this.masterDataService.listPriceLists();
  }

  @Post('price-lists')
  async createPriceList(
    @Req() req: RequestWithTenant,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['createPriceList']>> {
    const row = await this.masterDataService.createPriceList(this.parsePriceList(body));
    await this.auditWrite(req, 'MASTER_DATA_PRICE_LIST_CREATE', 'PriceList', row.id, {
      code: row.code,
      scope: row.scope
    });
    return row;
  }

  @Put('price-lists/:id')
  async updatePriceList(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: PrimitivePayload
  ): Promise<ReturnType<MasterDataService['updatePriceList']>> {
    const row = await this.masterDataService.updatePriceList(id, this.parsePriceListPartial(body));
    await this.auditWrite(req, 'MASTER_DATA_PRICE_LIST_UPDATE', 'PriceList', row.id, {
      code: row.code,
      scope: row.scope
    });
    return row;
  }

  private async auditWrite(
    req: RequestWithTenant,
    action: string,
    entity: string,
    entityId?: string,
    metadata?: Record<string, unknown>,
    companyIdOverride?: string
  ): Promise<void> {
    const companyId = companyIdOverride ?? this.requireCompanyId(req);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action,
      entity,
      entityId,
      metadata
    });
  }

  private requireCompanyId(req: RequestWithTenant): string {
    const companyId = req.user?.company_id ?? req.companyId;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }

  private resolveTargetCompanyId(req: RequestWithTenant, requestedCompanyId: unknown): string {
    const actorCompanyId = this.requireCompanyId(req);
    const requested =
      typeof requestedCompanyId === 'string'
        ? requestedCompanyId.trim()
        : typeof requestedCompanyId === 'number'
          ? String(requestedCompanyId)
          : '';

    if (!requested || requested === actorCompanyId) {
      return actorCompanyId;
    }

    const roles = req.user?.roles ?? [];
    if (!roles.includes('platform_owner')) {
      throw new ForbiddenException('Cross-tenant master-data management requires platform_owner role');
    }
    return requested;
  }

  private parseRoles(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  }

  private parseImportRows(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
      .filter((row): row is Record<string, unknown> => Boolean(row));
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private parsePriceList(body: PrimitivePayload): CreatePriceList {
    const scope =
      body.scope === 'GLOBAL' || body.scope === 'BRANCH' || body.scope === 'TIER' || body.scope === 'CONTRACT'
        ? body.scope
        : 'GLOBAL';

    return {
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      scope,
      branchId: body.branchId ? String(body.branchId) : null,
      customerTier: body.customerTier ? String(body.customerTier) : null,
      customerId: body.customerId ? String(body.customerId) : null,
      startsAt: String(body.startsAt ?? new Date().toISOString()),
      endsAt: body.endsAt ? String(body.endsAt) : null,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      rules: this.parseRules(body.rules)
    };
  }

  private parsePriceListPartial(body: PrimitivePayload): Partial<CreatePriceList> {
    const payload: Partial<CreatePriceList> = {};
    if (body.code !== undefined) payload.code = String(body.code);
    if (body.name !== undefined) payload.name = String(body.name);
    if (body.scope === 'GLOBAL' || body.scope === 'BRANCH' || body.scope === 'TIER' || body.scope === 'CONTRACT') {
      payload.scope = body.scope;
    }
    if (body.branchId !== undefined) payload.branchId = body.branchId ? String(body.branchId) : null;
    if (body.customerTier !== undefined) payload.customerTier = body.customerTier ? String(body.customerTier) : null;
    if (body.customerId !== undefined) payload.customerId = body.customerId ? String(body.customerId) : null;
    if (body.startsAt !== undefined) payload.startsAt = String(body.startsAt);
    if (body.endsAt !== undefined) payload.endsAt = body.endsAt ? String(body.endsAt) : null;
    if (body.isActive !== undefined) payload.isActive = Boolean(body.isActive);
    if (body.rules !== undefined) payload.rules = this.parseRules(body.rules);
    return payload;
  }

  private parseRules(
    value: unknown
  ): Array<{
    id?: string;
    productId: string;
    flowMode?: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';
    unitPrice: number;
    discountCapPct: number;
    priority: number;
  }> {
    if (!Array.isArray(value)) {
      return [];
    }

    type ParsedRule = {
      id?: string;
      productId: string;
      flowMode?: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';
      unitPrice: number;
      discountCapPct: number;
      priority: number;
    };
    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const row = entry as Record<string, unknown>;
        if (!row.productId) {
          return null;
        }
        const flowModeValue = row.flowMode ?? row.flow_mode;

        const parsed: ParsedRule = {
          id: row.id ? String(row.id) : undefined,
          productId: String(row.productId),
          flowMode:
            flowModeValue === 'REFILL_EXCHANGE' || flowModeValue === 'NON_REFILL' || flowModeValue === 'ANY'
              ? flowModeValue
              : 'ANY',
          unitPrice: Number(row.unitPrice ?? 0),
          discountCapPct: Number(row.discountCapPct ?? 0),
          priority: Number(row.priority ?? 4)
        };
        return parsed;
      })
      .filter((row): row is ParsedRule => Boolean(row));
  }
}
