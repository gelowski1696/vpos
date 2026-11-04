import type {
  DesktopHeldCartRecord,
  DesktopPaymentMethod,
  DesktopPaymentMode,
  DesktopSaleLine,
  DesktopSaleType
} from '../db/schema';
import { desktopPosService } from './desktop-pos.service';

export type HoldCartInput = {
  label: string;
  customerId: string | null;
  customerName: string | null;
  customerProvince?: string | null;
  customerCity?: string | null;
  personnelId?: string | null;
  personnelName?: string | null;
  helperId?: string | null;
  helperName?: string | null;
  saleType: DesktopSaleType;
  paymentMode?: DesktopPaymentMode;
  paymentMethod: DesktopPaymentMethod;
  paidAmount?: number;
  discountAmount: number;
  deliveryFee?: number;
  notes: string | null;
  lines: DesktopSaleLine[];
};

export class DesktopHeldCartService {
  async listHeldCarts(): Promise<DesktopHeldCartRecord[]> {
    return desktopPosService.listHeldCarts();
  }

  async holdCart(input: HoldCartInput): Promise<DesktopHeldCartRecord> {
    return desktopPosService.holdCart({
      label: input.label,
      customer: input.customerId ? {
        id: input.customerId,
        label: input.customerName ?? input.customerId,
        province: input.customerProvince ?? undefined,
        city: input.customerCity ?? undefined
      } : null,
      personnel: input.personnelId ? { id: input.personnelId, label: input.personnelName ?? input.personnelId } : null,
      helper: input.helperId ? { id: input.helperId, label: input.helperName ?? input.helperId } : null,
      saleType: input.saleType,
      paymentMode: input.paymentMode ?? 'FULL',
      paymentMethod: input.paymentMethod,
      paidAmount: Number(input.paidAmount ?? 0),
      discountAmount: input.discountAmount,
      deliveryFee: input.deliveryFee ?? 0,
      notes: input.notes,
      lines: input.lines
    });
  }

  async removeHeldCart(id: string): Promise<void> {
    await desktopPosService.removeHeldCart(id);
  }
}

export const desktopHeldCartService = new DesktopHeldCartService();
