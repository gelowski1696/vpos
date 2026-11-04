export type LpgComposerType = 'DISPOSE' | 'REPLACE' | 'JUNK';

export type LpgComposerQtyContext = {
  composerType: LpgComposerType;
  selectedProductQtyEmpty?: number | null;
  selectedDisposedEntryAvailableQty?: number | null;
};

export function sanitizeLpgComposerQtyInput(value: string): string {
  const match = String(value).trim().match(/^\d+/);
  if (!match) {
    return '';
  }
  return String(Math.trunc(Number(match[0])));
}

export function parseLpgComposerQtyInput(value: string): number {
  const normalized = sanitizeLpgComposerQtyInput(value);
  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.trunc(parsed);
}

export function resolveLpgComposerMaxQty(context: LpgComposerQtyContext): number {
  const selectedProductQtyEmpty = Number(context.selectedProductQtyEmpty ?? 0);
  const selectedDisposedAvailableQty = Number(context.selectedDisposedEntryAvailableQty ?? 0);
  const normalizedProductQtyEmpty = Number.isFinite(selectedProductQtyEmpty)
    ? Math.max(0, Math.floor(selectedProductQtyEmpty))
    : 0;
  const normalizedDisposedAvailableQty = Number.isFinite(selectedDisposedAvailableQty)
    ? Math.max(0, Math.floor(selectedDisposedAvailableQty))
    : 0;

  if (context.composerType === 'DISPOSE') {
    return normalizedProductQtyEmpty;
  }

  return normalizedDisposedAvailableQty;
}
