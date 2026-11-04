import type {
  DesktopCatalogProduct,
  DesktopShiftInventorySnapshot,
  DesktopShiftInventorySnapshotLine
} from '../db/schema';
import { desktopMasterDataService } from './desktop-master-data.service';
import {
  desktopStockProjectionService,
  type DesktopProjectedInventoryTotals
} from './desktop-stock-projection.service';

export type DesktopShiftInventoryReportRow = {
  productId: string;
  sku: string;
  productName: string;
  category: string;
  unit: string;
  isLpg: boolean;
  startQtyOnHand: number;
  endQtyOnHand: number;
  deltaQtyOnHand: number;
  startQtyFull: number;
  endQtyFull: number;
  deltaQtyFull: number;
  startQtyEmpty: number;
  endQtyEmpty: number;
  deltaQtyEmpty: number;
  changed: boolean;
};

export type DesktopShiftInventoryReportTotals = {
  itemCount: number;
  changedCount: number;
  startQtyOnHand: number;
  endQtyOnHand: number;
  deltaQtyOnHand: number;
  startQtyFull: number;
  endQtyFull: number;
  deltaQtyFull: number;
  startQtyEmpty: number;
  endQtyEmpty: number;
  deltaQtyEmpty: number;
};

export type DesktopShiftInventoryReport = {
  openingSnapshot: DesktopShiftInventorySnapshot | null;
  closingSnapshot: DesktopShiftInventorySnapshot;
  hasOpeningSnapshot: boolean;
  rows: DesktopShiftInventoryReportRow[];
  totals: DesktopShiftInventoryReportTotals;
};

type CaptureSnapshotInput = {
  locationId: string;
  locationLabel?: string | null;
};

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function emptySnapshotLine(productId: string): DesktopShiftInventorySnapshotLine {
  return {
    productId,
    sku: productId,
    productName: productId,
    category: 'Uncategorized',
    unit: 'unit',
    isLpg: false,
    qtyOnHand: 0,
    qtyFull: 0,
    qtyEmpty: 0
  };
}

function toSnapshotLine(
  product: DesktopCatalogProduct,
  projected?: DesktopProjectedInventoryTotals
): DesktopShiftInventorySnapshotLine {
  return {
    productId: product.id,
    sku: product.sku,
    productName: product.name,
    category: product.category,
    unit: product.unit,
    isLpg: product.isLpg,
    qtyOnHand: round4(projected?.qtyOnHand ?? product.qtyOnHand),
    qtyFull: round4(projected?.qtyFull ?? product.qtyFull),
    qtyEmpty: round4(projected?.qtyEmpty ?? product.qtyEmpty)
  };
}

function lineChanged(row: DesktopShiftInventoryReportRow): boolean {
  return (
    Math.abs(row.deltaQtyOnHand) > 0.0001 ||
    Math.abs(row.deltaQtyFull) > 0.0001 ||
    Math.abs(row.deltaQtyEmpty) > 0.0001
  );
}

function makeReportRow(
  productId: string,
  openingLine: DesktopShiftInventorySnapshotLine | undefined,
  closingLine: DesktopShiftInventorySnapshotLine | undefined
): DesktopShiftInventoryReportRow {
  const source = closingLine ?? openingLine ?? emptySnapshotLine(productId);
  const start = openingLine ?? emptySnapshotLine(productId);
  const end = closingLine ?? emptySnapshotLine(productId);
  const row: DesktopShiftInventoryReportRow = {
    productId,
    sku: source.sku,
    productName: source.productName,
    category: source.category,
    unit: source.unit,
    isLpg: source.isLpg,
    startQtyOnHand: round4(start.qtyOnHand),
    endQtyOnHand: round4(end.qtyOnHand),
    deltaQtyOnHand: round4(end.qtyOnHand - start.qtyOnHand),
    startQtyFull: round4(start.qtyFull),
    endQtyFull: round4(end.qtyFull),
    deltaQtyFull: round4(end.qtyFull - start.qtyFull),
    startQtyEmpty: round4(start.qtyEmpty),
    endQtyEmpty: round4(end.qtyEmpty),
    deltaQtyEmpty: round4(end.qtyEmpty - start.qtyEmpty),
    changed: false
  };
  return { ...row, changed: lineChanged(row) };
}

function sumRows(
  rows: DesktopShiftInventoryReportRow[],
  key: keyof Pick<
    DesktopShiftInventoryReportRow,
    | 'startQtyOnHand'
    | 'endQtyOnHand'
    | 'deltaQtyOnHand'
    | 'startQtyFull'
    | 'endQtyFull'
    | 'deltaQtyFull'
    | 'startQtyEmpty'
    | 'endQtyEmpty'
    | 'deltaQtyEmpty'
  >
): number {
  return round4(rows.reduce((sum, row) => sum + Number(row[key]), 0));
}

export function buildShiftInventoryReport(
  openingSnapshot: DesktopShiftInventorySnapshot | null | undefined,
  closingSnapshot: DesktopShiftInventorySnapshot
): DesktopShiftInventoryReport {
  const openingByProduct = new Map(
    (openingSnapshot?.lines ?? []).map((line) => [line.productId, line] as const)
  );
  const closingByProduct = new Map(closingSnapshot.lines.map((line) => [line.productId, line] as const));
  const productIds = Array.from(
    new Set([...openingByProduct.keys(), ...closingByProduct.keys()])
  );
  const rows = productIds
    .map((productId) =>
      makeReportRow(productId, openingByProduct.get(productId), closingByProduct.get(productId))
    )
    .sort((left, right) => {
      if (left.changed !== right.changed) {
        return left.changed ? -1 : 1;
      }
      return left.productName.localeCompare(right.productName);
    });

  return {
    openingSnapshot: openingSnapshot ?? null,
    closingSnapshot,
    hasOpeningSnapshot: Boolean(openingSnapshot),
    rows,
    totals: {
      itemCount: rows.length,
      changedCount: rows.filter((row) => row.changed).length,
      startQtyOnHand: sumRows(rows, 'startQtyOnHand'),
      endQtyOnHand: sumRows(rows, 'endQtyOnHand'),
      deltaQtyOnHand: sumRows(rows, 'deltaQtyOnHand'),
      startQtyFull: sumRows(rows, 'startQtyFull'),
      endQtyFull: sumRows(rows, 'endQtyFull'),
      deltaQtyFull: sumRows(rows, 'deltaQtyFull'),
      startQtyEmpty: sumRows(rows, 'startQtyEmpty'),
      endQtyEmpty: sumRows(rows, 'endQtyEmpty'),
      deltaQtyEmpty: sumRows(rows, 'deltaQtyEmpty')
    }
  };
}

export class DesktopShiftInventoryReportService {
  async captureSnapshot(input: CaptureSnapshotInput): Promise<DesktopShiftInventorySnapshot> {
    const locationId = input.locationId.trim();
    const [catalog, projectedInventory] = locationId
      ? await Promise.all([
          desktopMasterDataService.loadCatalog(locationId),
          desktopStockProjectionService.loadProjectedInventoryByProduct(locationId)
        ])
      : [[], new Map<string, DesktopProjectedInventoryTotals>()];
    const lines = catalog
      .map((product) => toSnapshotLine(product, projectedInventory.get(product.id)))
      .sort((left, right) => left.productName.localeCompare(right.productName));

    return {
      capturedAt: new Date().toISOString(),
      locationId,
      locationLabel: input.locationLabel ?? null,
      lines
    };
  }

  buildReport(
    openingSnapshot: DesktopShiftInventorySnapshot | null | undefined,
    closingSnapshot: DesktopShiftInventorySnapshot
  ): DesktopShiftInventoryReport {
    return buildShiftInventoryReport(openingSnapshot, closingSnapshot);
  }
}

export const desktopShiftInventoryReportService = new DesktopShiftInventoryReportService();
