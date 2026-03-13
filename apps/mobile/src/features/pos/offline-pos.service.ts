import { NoPrinterAdapter, PrinterAdapter, ReceiptDocument, printReceipt } from '@vpos/printing-core';
import type { SQLiteDatabase } from 'expo-sqlite';
import { SQLiteOutboxRepository } from '../../outbox/sqlite-outbox.repository';
import { OfflineTransactionService } from '../../services/offline-transaction.service';
import { MobileSubscriptionPolicyService } from '../sync/mobile-subscription-policy.service';

type CatalogProduct = {
  id: string;
  name: string;
  unitPrice: number;
  barcode?: string;
  isFavorite?: boolean;
};

type CartLine = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  isFavorite: boolean;
};

type SplitPayment = {
  method: 'CASH' | 'CARD' | 'E_WALLET';
  amount: number;
  referenceNo?: string;
};

type CheckoutInput = {
  branchId: string;
  locationId: string;
  customerId?: string | null;
  saleType?: 'PICKUP' | 'DELIVERY';
};

type ReceiptRow = {
  sale_id: string;
  receipt_number: string;
  payload: string;
  reprint_count: number;
};

export class OfflinePosService {
  private readonly catalog = new Map<string, CatalogProduct>();
  private readonly cart = new Map<string, CartLine>();
  private splitPayments: SplitPayment[] = [];
  private discountAmount = 0;

  constructor(
    private readonly db: SQLiteDatabase,
    private readonly printer: PrinterAdapter = new NoPrinterAdapter(),
    private readonly subscriptionPolicy?: MobileSubscriptionPolicyService
  ) {}

  setCatalog(products: CatalogProduct[]): void {
    this.catalog.clear();
    for (const product of products) {
      this.catalog.set(product.id, {
        ...product,
        isFavorite: product.isFavorite ?? false
      });
    }
  }

  searchProducts(query: string): CatalogProduct[] {
    const term = query.trim().toLowerCase();
    if (!term) {
      return [...this.catalog.values()];
    }
    return [...this.catalog.values()].filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        product.id.toLowerCase().includes(term) ||
        (product.barcode ?? '').toLowerCase().includes(term)
    );
  }

  scanBarcode(barcode: string): CatalogProduct | undefined {
    const code = barcode.trim().toLowerCase();
    return [...this.catalog.values()].find((product) => (product.barcode ?? '').toLowerCase() === code);
  }

  toggleFavorite(productId: string): boolean {
    const product = this.requireCatalogProduct(productId);
    const updated = !Boolean(product.isFavorite);
    this.catalog.set(productId, { ...product, isFavorite: updated });

    const cartRow = this.cart.get(productId);
    if (cartRow) {
      this.cart.set(productId, { ...cartRow, isFavorite: updated });
    }

    return updated;
  }

  addToCart(productId: string, quantity = 1): void {
    if (quantity <= 0) {
      throw new Error('Quantity must be greater than zero');
    }
    const product = this.requireCatalogProduct(productId);
    const existing = this.cart.get(productId);
    const nextQty = (existing?.quantity ?? 0) + quantity;
    this.cart.set(productId, {
      productId,
      name: product.name,
      quantity: nextQty,
      unitPrice: product.unitPrice,
      isFavorite: Boolean(product.isFavorite)
    });
  }

  updateCartQuantity(productId: string, quantity: number): void {
    const existing = this.cart.get(productId);
    if (!existing) {
      throw new Error('Cart line not found');
    }
    if (quantity <= 0) {
      this.cart.delete(productId);
      return;
    }
    this.cart.set(productId, { ...existing, quantity });
  }

  setDiscountAmount(value: number): void {
    this.discountAmount = Number(Math.max(0, value).toFixed(2));
  }

  setSplitPayments(payments: SplitPayment[]): void {
    this.splitPayments = payments
      .filter((payment) => payment.amount > 0)
      .map((payment) => ({
        method: payment.method,
        amount: Number(payment.amount.toFixed(2)),
        referenceNo: payment.referenceNo
      }));
  }

  getCartSnapshot(): {
    items: CartLine[];
    subtotal: number;
    discountAmount: number;
    totalAmount: number;
    paymentTotal: number;
  } {
    const items = [...this.cart.values()];
    const subtotal = Number(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0).toFixed(2));
    const discountAmount = Number(Math.min(this.discountAmount, subtotal).toFixed(2));
    const totalAmount = Number((subtotal - discountAmount).toFixed(2));
    const paymentTotal = Number(this.splitPayments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2));
    return { items, subtotal, discountAmount, totalAmount, paymentTotal };
  }

  async checkout(input: CheckoutInput): Promise<{
    saleId: string;
    receiptNumber: string;
    receiptDocument: ReceiptDocument;
  }> {
    const snapshot = this.getCartSnapshot();
    if (snapshot.items.length === 0) {
      throw new Error('Cart is empty');
    }
    if (snapshot.paymentTotal !== snapshot.totalAmount) {
      throw new Error('Split payment total must match sale total');
    }

    const tx = new OfflineTransactionService(this.db, this.subscriptionPolicy);
    const saleId = await tx.createOfflineSale({
      branchId: input.branchId,
      locationId: input.locationId,
      customerId: input.customerId ?? null,
      saleType: input.saleType ?? 'PICKUP',
      discountAmount: snapshot.discountAmount,
      lines: snapshot.items.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice
      })),
      payments: this.splitPayments.map((payment) => ({
        method: payment.method,
        amount: payment.amount
      }))
    });

    const receiptNumber = this.buildReceiptNumber(input.branchId, saleId);
    const receiptDocument = this.buildReceiptDocument(saleId, receiptNumber, snapshot.items, snapshot);
    const now = new Date().toISOString();
    await this.db.runAsync(
      `
      INSERT INTO receipts_local(sale_id, receipt_number, payload, reprint_count, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
      `,
      saleId,
      receiptNumber,
      JSON.stringify(receiptDocument),
      now,
      now
    );

    await printReceipt(this.printer, receiptDocument);
    this.resetCart();
    return { saleId, receiptNumber, receiptDocument };
  }

  async reprint(saleId: string): Promise<{
    saleId: string;
    receiptNumber: string;
    receiptDocument: ReceiptDocument;
  }> {
    const row = await this.db.getFirstAsync<ReceiptRow>(
      'SELECT sale_id, receipt_number, payload, reprint_count FROM receipts_local WHERE sale_id = ?',
      saleId
    );
    if (!row) {
      throw new Error('Receipt not found for sale');
    }

    const original = JSON.parse(row.payload) as ReceiptDocument;
    const receiptDocument: ReceiptDocument = { ...original, isReprint: true };
    const printable: ReceiptDocument = {
      ...receiptDocument,
      isReprint: false,
      lines: [{ align: 'center', emphasis: true, text: '*** REPRINT ***' }, ...receiptDocument.lines]
    };

    const now = new Date().toISOString();
    await this.db.runAsync(
      'UPDATE receipts_local SET reprint_count = reprint_count + 1, updated_at = ? WHERE sale_id = ?',
      now,
      saleId
    );

    const outbox = new SQLiteOutboxRepository(this.db);
    await outbox.enqueue({
      id: `reprint-${saleId}-${Date.now()}`,
      entity: 'receipt',
      action: 'reprint',
      payload: {
        sale_id: saleId,
        receipt_number: row.receipt_number,
        reprinted_at: now
      },
      idempotencyKey: `idem-reprint-${saleId}-${Date.now()}`
    });

    await printReceipt(this.printer, printable);
    return {
      saleId,
      receiptNumber: row.receipt_number,
      receiptDocument
    };
  }

  private resetCart(): void {
    this.cart.clear();
    this.splitPayments = [];
    this.discountAmount = 0;
  }

  private requireCatalogProduct(productId: string): CatalogProduct {
    const product = this.catalog.get(productId);
    if (!product) {
      throw new Error('Product not found');
    }
    return product;
  }

  private buildReceiptNumber(branchId: string, saleId: string): string {
    const compact = saleId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase() || '000001';
    return `${branchId.toUpperCase()}-${compact}`;
  }

  private buildReceiptDocument(
    saleId: string,
    receiptNumber: string,
    lines: CartLine[],
    snapshot: ReturnType<OfflinePosService['getCartSnapshot']>
  ): ReceiptDocument {
    return {
      title: 'VPOS RECEIPT',
      isReprint: false,
      lines: [
        { align: 'center', emphasis: true, text: `Receipt #${receiptNumber}` },
        { align: 'left', text: `Sale ID: ${saleId}` },
        ...lines.map((line) => ({
          align: 'left' as const,
          text: `${line.quantity} x ${line.name} @ ${line.unitPrice.toFixed(2)}`
        })),
        { align: 'left', text: `Subtotal: ${snapshot.subtotal.toFixed(2)}` },
        { align: 'left', text: `Discount: ${snapshot.discountAmount.toFixed(2)}` },
        { align: 'left', text: `Total: ${snapshot.totalAmount.toFixed(2)}` }
      ],
      footer: 'Thank you for choosing VPOS LPG.'
    };
  }
}
