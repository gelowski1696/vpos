import { PrismaClient, CustomerType, CylinderOwnership, CylinderStatus, LocationType, PriceScope } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const company = await prisma.company.upsert({
    where: { code: 'DEMO' },
    update: {
      name: 'VPOS Demo LPG Co.',
      externalClientId: 'DEMO',
      subscriptionStatus: 'ACTIVE'
    },
    create: {
      code: 'DEMO',
      externalClientId: 'DEMO',
      name: 'VPOS Demo LPG Co.',
      subscriptionStatus: 'ACTIVE',
      currencyCode: 'PHP',
      timezone: 'Asia/Manila'
    }
  });

  await prisma.companyEntitlement.upsert({
    where: { companyId: company.id },
    update: {
      externalClientId: 'DEMO',
      status: 'ACTIVE',
      maxBranches: 10,
      branchMode: 'MULTI',
      inventoryMode: 'STORE_WAREHOUSE',
      allowDelivery: true,
      allowTransfers: true,
      allowMobile: true,
      lastSyncedAt: new Date()
    },
    create: {
      companyId: company.id,
      externalClientId: 'DEMO',
      status: 'ACTIVE',
      maxBranches: 10,
      branchMode: 'MULTI',
      inventoryMode: 'STORE_WAREHOUSE',
      allowDelivery: true,
      allowTransfers: true,
      allowMobile: true,
      lastSyncedAt: new Date()
    }
  });

  await prisma.brandingConfig.upsert({
    where: { companyId: company.id },
    update: {
      companyName: 'VPOS Demo LPG Co.',
      primaryColor: '#0B3C5D',
      secondaryColor: '#328CC1',
      receiptFooterText: 'Thank you for choosing VPOS LPG.'
    },
    create: {
      companyId: company.id,
      companyName: 'VPOS Demo LPG Co.',
      primaryColor: '#0B3C5D',
      secondaryColor: '#328CC1',
      receiptFooterText: 'Thank you for choosing VPOS LPG.'
    }
  });

  const mainBranch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: 'MAIN' } },
    update: { name: 'Demo Main Branch' },
    create: {
      companyId: company.id,
      code: 'MAIN',
      name: 'Demo Main Branch'
    }
  });

  const warehouseBranch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: 'WH1' } },
    update: { name: 'Demo Warehouse' },
    create: {
      companyId: company.id,
      code: 'WH1',
      name: 'Demo Warehouse'
    }
  });

  const mainLocation = await prisma.location.upsert({
    where: { companyId_code: { companyId: company.id, code: 'LOC-MAIN' } },
    update: { name: 'Main Store', type: LocationType.BRANCH_STORE, branchId: mainBranch.id },
    create: {
      companyId: company.id,
      branchId: mainBranch.id,
      code: 'LOC-MAIN',
      name: 'Main Store',
      type: LocationType.BRANCH_STORE
    }
  });

  const warehouseLocation = await prisma.location.upsert({
    where: { companyId_code: { companyId: company.id, code: 'LOC-WH1' } },
    update: { name: 'Main Warehouse', type: LocationType.BRANCH_WAREHOUSE, branchId: warehouseBranch.id },
    create: {
      companyId: company.id,
      branchId: warehouseBranch.id,
      code: 'LOC-WH1',
      name: 'Main Warehouse',
      type: LocationType.BRANCH_WAREHOUSE
    }
  });

  await prisma.location.upsert({
    where: { companyId_code: { companyId: company.id, code: 'TRUCK-01' } },
    update: { name: 'Demo Truck-01', type: LocationType.TRUCK },
    create: {
      companyId: company.id,
      code: 'TRUCK-01',
      name: 'Demo Truck-01',
      type: LocationType.TRUCK
    }
  });

  await prisma.location.upsert({
    where: { companyId_code: { companyId: company.id, code: 'PERSONNEL-01' } },
    update: { name: 'Demo Personnel-01', type: LocationType.PERSONNEL },
    create: {
      companyId: company.id,
      code: 'PERSONNEL-01',
      name: 'Demo Personnel-01',
      type: LocationType.PERSONNEL
    }
  });

  const adminRole = await prisma.role.upsert({
    where: { companyId_name: { companyId: company.id, name: 'admin' } },
    update: {},
    create: { companyId: company.id, name: 'admin' }
  });

  const supervisorRole = await prisma.role.upsert({
    where: { companyId_name: { companyId: company.id, name: 'supervisor' } },
    update: {},
    create: { companyId: company.id, name: 'supervisor' }
  });

  const cashierRole = await prisma.role.upsert({
    where: { companyId_name: { companyId: company.id, name: 'cashier' } },
    update: {},
    create: { companyId: company.id, name: 'cashier' }
  });

  const driverRole = await prisma.role.upsert({
    where: { companyId_name: { companyId: company.id, name: 'driver' } },
    update: {},
    create: { companyId: company.id, name: 'driver' }
  });

  const users = [
    { email: 'admin@vpos.local', fullName: 'Demo Admin', password: 'Admin@123', roles: [adminRole.id, supervisorRole.id] },
    { email: 'supervisor@vpos.local', fullName: 'Demo Supervisor', password: 'Supervisor@123', roles: [supervisorRole.id] },
    { email: 'cashier@vpos.local', fullName: 'Demo Cashier', password: 'Cashier@123', roles: [cashierRole.id] },
    { email: 'driver@vpos.local', fullName: 'Demo Driver', password: 'Driver@123', roles: [driverRole.id] }
  ];

  for (const userSeed of users) {
    const user = await prisma.user.upsert({
      where: { companyId_email: { companyId: company.id, email: userSeed.email } },
      update: { fullName: userSeed.fullName },
      create: {
        companyId: company.id,
        branchId: mainBranch.id,
        email: userSeed.email,
        fullName: userSeed.fullName,
        passwordHash: await argon2.hash(userSeed.password)
      }
    });

    for (const roleId of userSeed.roles) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        update: {},
        create: { userId: user.id, roleId }
      });
    }
  }

  const cyl11 = await prisma.cylinderType.upsert({
    where: { companyId_code: { companyId: company.id, code: 'CYL-11' } },
    update: { name: '11kg Standard Cylinder', sizeKg: 11, depositAmount: 1200 },
    create: {
      companyId: company.id,
      code: 'CYL-11',
      name: '11kg Standard Cylinder',
      sizeKg: 11,
      depositAmount: 1200
    }
  });

  const cyl22 = await prisma.cylinderType.upsert({
    where: { companyId_code: { companyId: company.id, code: 'CYL-22' } },
    update: { name: '22kg Standard Cylinder', sizeKg: 22, depositAmount: 2200 },
    create: {
      companyId: company.id,
      code: 'CYL-22',
      name: '22kg Standard Cylinder',
      sizeKg: 22,
      depositAmount: 2200
    }
  });

  await prisma.productCategory.upsert({
    where: { companyId_code: { companyId: company.id, code: 'LPG-REFILL' } },
    update: { name: 'LPG Refill', isActive: true },
    create: {
      companyId: company.id,
      code: 'LPG-REFILL',
      name: 'LPG Refill',
      isActive: true
    }
  });

  await prisma.productBrand.upsert({
    where: { companyId_code: { companyId: company.id, code: 'VMJAM' } },
    update: { name: 'VMJAM', isActive: true },
    create: {
      companyId: company.id,
      code: 'VMJAM',
      name: 'VMJAM',
      isActive: true
    }
  });

  const product11 = await prisma.product.upsert({
    where: { companyId_sku: { companyId: company.id, sku: 'LPG-11-REFILL' } },
    update: {
      name: 'LPG Refill 11kg',
      category: 'LPG Refill',
      brand: 'VMJAM',
      isLpg: true,
      cylinderTypeId: cyl11.id,
      unit: 'unit',
      standardCost: 700,
      lowStockAlertQty: 5
    },
    create: {
      companyId: company.id,
      sku: 'LPG-11-REFILL',
      name: 'LPG Refill 11kg',
      category: 'LPG Refill',
      brand: 'VMJAM',
      isLpg: true,
      cylinderTypeId: cyl11.id,
      unit: 'unit',
      standardCost: 700,
      lowStockAlertQty: 5
    }
  });

  const product22 = await prisma.product.upsert({
    where: { companyId_sku: { companyId: company.id, sku: 'LPG-22-REFILL' } },
    update: {
      name: 'LPG Refill 22kg',
      category: 'LPG Refill',
      brand: 'VMJAM',
      isLpg: true,
      cylinderTypeId: cyl22.id,
      unit: 'unit',
      standardCost: 1300,
      lowStockAlertQty: 3
    },
    create: {
      companyId: company.id,
      sku: 'LPG-22-REFILL',
      name: 'LPG Refill 22kg',
      category: 'LPG Refill',
      brand: 'VMJAM',
      isLpg: true,
      cylinderTypeId: cyl22.id,
      unit: 'unit',
      standardCost: 1300,
      lowStockAlertQty: 3
    }
  });

  await prisma.customer.upsert({
    where: { companyId_code: { companyId: company.id, code: 'CUST-RETAIL-001' } },
    update: { name: 'Walk-in Customer', type: CustomerType.RETAIL, tier: 'REGULAR' },
    create: {
      companyId: company.id,
      code: 'CUST-RETAIL-001',
      name: 'Walk-in Customer',
      type: CustomerType.RETAIL,
      tier: 'REGULAR'
    }
  });

  const globalList = await prisma.priceList.upsert({
    where: { companyId_code: { companyId: company.id, code: 'PL-GLOBAL-2026' } },
    update: {
      name: 'Global 2026 Default',
      scope: PriceScope.GLOBAL,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      branchId: null,
      customerTier: null
    },
    create: {
      companyId: company.id,
      code: 'PL-GLOBAL-2026',
      name: 'Global 2026 Default',
      scope: PriceScope.GLOBAL,
      startsAt: new Date('2026-01-01T00:00:00.000Z')
    }
  });

  const branchList = await prisma.priceList.upsert({
    where: { companyId_code: { companyId: company.id, code: 'PL-BRANCH-MAIN' } },
    update: {
      name: 'Main Branch Override',
      scope: PriceScope.BRANCH,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      branchId: mainBranch.id,
      customerTier: null
    },
    create: {
      companyId: company.id,
      code: 'PL-BRANCH-MAIN',
      branchId: mainBranch.id,
      name: 'Main Branch Override',
      scope: PriceScope.BRANCH,
      startsAt: new Date('2026-01-01T00:00:00.000Z')
    }
  });

  const tierList = await prisma.priceList.upsert({
    where: { companyId_code: { companyId: company.id, code: 'PL-TIER-PREMIUM' } },
    update: {
      name: 'Tier Premium',
      scope: PriceScope.TIER,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      branchId: null,
      customerTier: 'PREMIUM'
    },
    create: {
      companyId: company.id,
      code: 'PL-TIER-PREMIUM',
      name: 'Tier Premium',
      scope: PriceScope.TIER,
      customerTier: 'PREMIUM',
      startsAt: new Date('2026-01-01T00:00:00.000Z')
    }
  });

  await prisma.priceRule.deleteMany({
    where: {
      companyId: company.id,
      priceListId: { in: [globalList.id, branchList.id, tierList.id] }
    }
  });

  await prisma.priceRule.createMany({
    data: [
      {
        companyId: company.id,
        priceListId: globalList.id,
        productId: product11.id,
        unitPrice: 950,
        discountCapPct: 5,
        priority: 4
      },
      {
        companyId: company.id,
        priceListId: globalList.id,
        productId: product22.id,
        unitPrice: 1800,
        discountCapPct: 5,
        priority: 4
      },
      {
        companyId: company.id,
        priceListId: branchList.id,
        productId: product11.id,
        unitPrice: 940,
        discountCapPct: 8,
        priority: 3
      },
      {
        companyId: company.id,
        priceListId: tierList.id,
        productId: product11.id,
        unitPrice: 920,
        discountCapPct: 10,
        priority: 2
      }
    ]
  });

  await prisma.expenseCategory.upsert({
    where: { companyId_code: { companyId: company.id, code: 'FUEL' } },
    update: { name: 'Fuel Expense' },
    create: {
      companyId: company.id,
      code: 'FUEL',
      name: 'Fuel Expense'
    }
  });

  const cylinders = [
    { serial: 'CYL11-0001', typeId: cyl11.id, status: CylinderStatus.FULL },
    { serial: 'CYL11-0002', typeId: cyl11.id, status: CylinderStatus.EMPTY },
    { serial: 'CYL11-0003', typeId: cyl11.id, status: CylinderStatus.FULL },
    { serial: 'CYL22-0001', typeId: cyl22.id, status: CylinderStatus.FULL },
    { serial: 'CYL22-0002', typeId: cyl22.id, status: CylinderStatus.EMPTY }
  ];

  for (const item of cylinders) {
    await prisma.cylinder.upsert({
      where: { serial: item.serial },
      update: {
        cylinderTypeId: item.typeId,
        status: item.status,
        currentLocationId: warehouseLocation.id
      },
      create: {
        companyId: company.id,
        serial: item.serial,
        cylinderTypeId: item.typeId,
        ownership: CylinderOwnership.COMPANY,
        status: item.status,
        currentLocationId: warehouseLocation.id
      }
    });
  }

  await prisma.inventoryBalance.createMany({
    data: [
      {
        companyId: company.id,
        locationId: mainLocation.id,
        productId: product11.id,
        qtyOnHand: 25,
        avgCost: 700
      },
      {
        companyId: company.id,
        locationId: mainLocation.id,
        productId: product22.id,
        qtyOnHand: 15,
        avgCost: 1300
      },
      {
        companyId: company.id,
        locationId: warehouseLocation.id,
        productId: product11.id,
        qtyOnHand: 120,
        avgCost: 680
      },
      {
        companyId: company.id,
        locationId: warehouseLocation.id,
        productId: product22.id,
        qtyOnHand: 80,
        avgCost: 1300
      }
    ],
    skipDuplicates: true
  });

  await prisma.costingConfig.upsert({
    where: { companyId: company.id },
    update: {
      method: 'WAC',
      allowManualOverride: false,
      negativeStockPolicy: 'BLOCK_POSTING',
      includeFreight: false,
      includeHandling: false,
      includeOtherLandedCost: false,
      allocationBasis: 'PER_QUANTITY',
      roundingScale: 4,
      locked: false
    },
    create: {
      companyId: company.id,
      method: 'WAC',
      allowManualOverride: false,
      negativeStockPolicy: 'BLOCK_POSTING',
      includeFreight: false,
      includeHandling: false,
      includeOtherLandedCost: false,
      allocationBasis: 'PER_QUANTITY',
      roundingScale: 4,
      locked: false
    }
  });

  console.log('Seed completed for company', company.code);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
