import { Injectable, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { TenancyDatastoreMode, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';

type DbClient = PrismaService | PrismaClient;

@Injectable()
export class ChatService {
  private readonly anthropic: Anthropic;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService
  ) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async *streamResponse(companyId: string, message: string): AsyncGenerator<string> {
    const binding = await this.getTenantBinding(companyId);
    const context = await this.buildContext(binding, message);
    const today = new Date().toLocaleDateString('en-PH', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const systemPrompt = `You are a business intelligence assistant for this company's POS and inventory management system.
You MUST ONLY answer using the exact data provided in the context below.
If the answer is not present in the data, respond: "I don't have that information in the current data."
Do not use general knowledge. Do not make assumptions. Be concise and business-focused.
Format numbers clearly (e.g., ₱1,234.56 for currency amounts).
Today's date: ${today}

--- CURRENT SYSTEM DATA ---
${context}
--- END OF DATA ---`;

    const stream = this.anthropic.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }]
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield chunk.delta.text;
      }
    }
  }

  private async buildContext(
    binding: TenantPrismaBinding | null,
    message: string
  ): Promise<string> {
    if (!binding) {
      return 'No data available.';
    }

    const db = binding.client as DbClient;
    const companyId = binding.companyId;
    const lower = message.toLowerCase();

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [salesToday, salesMonth, branches, inventory] = await Promise.all([
      db.sale.aggregate({
        where: { companyId, status: 'ACTIVE', postedAt: { gte: startOfDay } },
        _sum: { totalAmount: true },
        _count: { id: true }
      }),
      db.sale.aggregate({
        where: { companyId, status: 'ACTIVE', postedAt: { gte: startOfMonth } },
        _sum: { totalAmount: true },
        _count: { id: true }
      }),
      db.branch.findMany({
        where: { companyId, isActive: true },
        select: { id: true, code: true, name: true }
      }),
      db.inventoryBalance.findMany({
        where: { companyId },
        include: {
          product: { select: { sku: true, name: true, isLpg: true, lowStockAlertQty: true } },
          location: { select: { code: true, name: true } }
        },
        orderBy: { updatedAt: 'desc' },
        take: 60
      })
    ]);

    const lowStock = inventory.filter(
      (b) =>
        b.product.lowStockAlertQty !== null &&
        Number(b.qtyOnHand) <= Number(b.product.lowStockAlertQty)
    );

    let ctx = `## Sales Summary
Today (${startOfDay.toDateString()}): ${salesToday._count.id} transactions, total ₱${Number(salesToday._sum.totalAmount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
This month: ${salesMonth._count.id} transactions, total ₱${Number(salesMonth._sum.totalAmount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}

## Branches (${branches.length} active)
${branches.map((b) => `- ${b.code}: ${b.name}`).join('\n')}

## Inventory Snapshot (${inventory.length} entries, last updated first)
${inventory.map((b) => `- [${b.location.code}] ${b.product.sku} "${b.product.name}": onHand=${b.qtyOnHand}${b.product.isLpg ? `, full=${b.qtyFull}, empty=${b.qtyEmpty}` : ''}`).join('\n')}
`;

    if (lowStock.length > 0) {
      ctx += `\n## Low Stock Alerts (${lowStock.length} items below threshold)\n`;
      ctx += lowStock
        .map(
          (b) =>
            `- [${b.location.code}] ${b.product.sku} "${b.product.name}": onHand=${b.qtyOnHand}, threshold=${b.product.lowStockAlertQty}`
        )
        .join('\n');
    }

    if (/customer|credit|balance|account/.test(lower)) {
      const customers = await db.customer.findMany({
        where: { companyId, isActive: true },
        select: {
          code: true,
          name: true,
          type: true,
          tier: true,
          depositBalance: true,
          pointsBalance: true
        },
        orderBy: { name: 'asc' },
        take: 60
      });
      ctx += `\n## Customers (${customers.length} active)\n`;
      ctx += customers
        .map(
          (c) =>
            `- ${c.code} "${c.name}" (${c.type}${c.tier ? `, tier: ${c.tier}` : ''}): deposit=₱${Number(c.depositBalance).toLocaleString('en-PH', { minimumFractionDigits: 2 })}, points=${c.pointsBalance}`
        )
        .join('\n');
    }

    if (/sale|sales|recent transaction|receipt/.test(lower)) {
      const recent = await db.sale.findMany({
        where: { companyId, status: 'ACTIVE' },
        select: {
          totalAmount: true,
          saleType: true,
          postedAt: true,
          branch: { select: { code: true } },
          customer: { select: { name: true, code: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 25
      });
      ctx += `\n## Recent Sales (last 25)\n`;
      ctx += recent
        .map(
          (s) =>
            `- [${s.branch.code}] ${s.saleType} ₱${Number(s.totalAmount).toLocaleString('en-PH', { minimumFractionDigits: 2 })} | customer: ${s.customer ? `${s.customer.code} ${s.customer.name}` : 'walk-in'} | posted: ${s.postedAt ? s.postedAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : 'pending'}`
        )
        .join('\n');
    }

    if (/delivery|deliver|rider/.test(lower)) {
      const deliveries = await db.deliveryOrder.findMany({
        where: { companyId },
        select: { id: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20
      });
      ctx += `\n## Recent Delivery Orders (last 20)\n`;
      ctx += deliveries
        .map(
          (d) =>
            `- ${d.id}: status=${d.status}, created=${d.createdAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`
        )
        .join('\n');
    }

    if (/transfer|stock move|replenish/.test(lower)) {
      const transfers = await db.stockTransfer.findMany({
        where: { companyId },
        select: {
          id: true,
          status: true,
          transferMode: true,
          createdAt: true,
          sourceLocation: { select: { code: true } },
          destinationLocation: { select: { code: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      });
      ctx += `\n## Recent Stock Transfers (last 20)\n`;
      ctx += transfers
        .map(
          (t) =>
            `- ${t.transferMode} from [${t.sourceLocation.code}] to [${t.destinationLocation.code}]: status=${t.status}, created=${t.createdAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`
        )
        .join('\n');
    }

    if (/product|item|sku|catalog/.test(lower)) {
      const products = await db.product.findMany({
        where: { companyId, isActive: true },
        select: {
          sku: true,
          name: true,
          category: true,
          unit: true,
          isLpg: true,
          standardCost: true,
          lowStockAlertQty: true
        },
        orderBy: { name: 'asc' },
        take: 100
      });
      ctx += `\n## Products (${products.length} active)\n`;
      ctx += products
        .map(
          (p) =>
            `- ${p.sku}: "${p.name}" (${p.category ?? 'no category'}, unit=${p.unit}${p.isLpg ? ', LPG' : ''}${p.standardCost ? `, cost=₱${Number(p.standardCost).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : ''}${p.lowStockAlertQty ? `, alert at ${p.lowStockAlertQty}` : ''})`
        )
        .join('\n');
    }

    if (/lending|borrow|cylinder/.test(lower)) {
      const lending = await db.lendingTransaction.findMany({
        where: { companyId, status: 'OPEN' },
        include: {
          customer: { select: { code: true, name: true } },
          lines: { select: { quantityLent: true, quantityReturned: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 30
      });
      ctx += `\n## Open Lending Transactions (not yet closed, last 30)\n`;
      ctx += lending
        .map((l) => {
          const totalLent = l.lines.reduce((s, line) => s + Number(line.quantityLent), 0);
          const totalReturned = l.lines.reduce((s, line) => s + Number(line.quantityReturned), 0);
          return `- ${l.customer.code} "${l.customer.name}": lent=${totalLent}, returned=${totalReturned}, outstanding=${totalLent - totalReturned}, since: ${l.openedAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`;
        })
        .join('\n');
    }

    return ctx;
  }

  private async getTenantBinding(companyId: string): Promise<TenantPrismaBinding | null> {
    if (!this.prisma || process.env.NODE_ENV === 'test') {
      return null;
    }
    if (!this.tenantRouter) {
      return {
        client: this.prisma,
        companyId,
        mode: TenancyDatastoreMode.SHARED_DB,
        datastoreRef: null
      };
    }
    return this.tenantRouter.forCompany(companyId);
  }
}
