export type PrinterType = 'IMIN' | 'GENERIC_BUILTIN' | 'BLUETOOTH' | 'NONE';

export interface ReceiptLine {
  align?: 'left' | 'center' | 'right';
  text: string;
  emphasis?: boolean;
  imageBase64?: string;
  imageWidth?: number;
}

export interface ReceiptDocument {
  title: string;
  lines: ReceiptLine[];
  footer?: string;
  footerEmphasis?: boolean;
  isReprint?: boolean;
  topPaddingLines?: number;
  bottomPaddingLines?: number;
}

export interface PrinterAdapter {
  print(lines: ReceiptLine[]): Promise<void>;
  testPrint(): Promise<void>;
}

export interface NativePrinterTransport {
  printEscPos(lines: ReceiptLine[], config?: Record<string, unknown> | null): Promise<void>;
  printIMin(lines: ReceiptLine[], config?: Record<string, unknown> | null): Promise<void>;
  testPrint(printerType: PrinterType, config?: Record<string, unknown> | null): Promise<void>;
}

export class NoPrinterAdapter implements PrinterAdapter {
  async print(): Promise<void> {
    return;
  }

  async testPrint(): Promise<void> {
    return;
  }
}

export class EscPosAdapter implements PrinterAdapter {
  constructor(
    private readonly transport?: NativePrinterTransport,
    private readonly config: Record<string, unknown> | null = null,
    private readonly printerType: PrinterType = 'GENERIC_BUILTIN'
  ) {}

  async print(lines: ReceiptLine[]): Promise<void> {
    if (!this.transport) {
      return;
    }
    await this.transport.printEscPos(lines, this.config);
  }

  async testPrint(): Promise<void> {
    if (!this.transport) {
      return;
    }
    await this.transport.testPrint(this.printerType, this.config);
  }
}

export class IMinAdapter implements PrinterAdapter {
  constructor(
    private readonly transport?: NativePrinterTransport,
    private readonly config: Record<string, unknown> | null = null
  ) {}

  async print(lines: ReceiptLine[]): Promise<void> {
    if (!this.transport) {
      return;
    }
    await this.transport.printIMin(lines, this.config);
  }

  async testPrint(): Promise<void> {
    if (!this.transport) {
      return;
    }
    await this.transport.testPrint('IMIN', this.config);
  }
}

function withReprintMarker(doc: ReceiptDocument): ReceiptLine[] {
  const lines = [...doc.lines];
  if (doc.isReprint) {
    lines.unshift({ align: 'center', emphasis: true, text: '*** REPRINT ***' });
  }
  lines.unshift({ align: 'center', emphasis: true, text: doc.title });
  if (doc.footer) {
    lines.push({ align: 'center', emphasis: doc.footerEmphasis ?? false, text: doc.footer });
  }
  return lines;
}

const DEFAULT_TOP_PADDING_LINES = 2;
const DEFAULT_BOTTOM_PADDING_LINES = 3;

function normalizePaddingLines(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  if (rounded < 0) {
    return 0;
  }
  if (rounded > 12) {
    return 12;
  }
  return rounded;
}

function buildBlankLines(count: number): ReceiptLine[] {
  if (count <= 0) {
    return [];
  }
  return Array.from({ length: count }, () => ({ align: 'left' as const, text: '' }));
}

function withPadding(lines: ReceiptLine[], topPaddingLines?: number, bottomPaddingLines?: number): ReceiptLine[] {
  const top = normalizePaddingLines(topPaddingLines, DEFAULT_TOP_PADDING_LINES);
  const bottom = normalizePaddingLines(bottomPaddingLines, DEFAULT_BOTTOM_PADDING_LINES);
  return [...buildBlankLines(top), ...lines, ...buildBlankLines(bottom)];
}

export async function printReceipt(adapter: PrinterAdapter, doc: ReceiptDocument): Promise<void> {
  await adapter.print(withPadding(withReprintMarker(doc), doc.topPaddingLines, doc.bottomPaddingLines));
}

export async function printXRead(adapter: PrinterAdapter, summaryLines: ReceiptLine[]): Promise<void> {
  await adapter.print(withPadding([{ align: 'center', emphasis: true, text: 'X-READ' }, ...summaryLines]));
}

export async function printZRead(adapter: PrinterAdapter, summaryLines: ReceiptLine[]): Promise<void> {
  await adapter.print(withPadding([{ align: 'center', emphasis: true, text: 'Z-READ' }, ...summaryLines]));
}

export async function testPrint(adapter: PrinterAdapter): Promise<void> {
  await adapter.testPrint();
}
