import { parseLpgComposerQtyInput, resolveLpgComposerMaxQty, sanitizeLpgComposerQtyInput } from '../src/screens/lpg-service-qty';

describe('resolveLpgComposerMaxQty', () => {
  it('keeps only whole-number input for the quantity field', () => {
    expect(sanitizeLpgComposerQtyInput('6.2')).toBe('6');
    expect(sanitizeLpgComposerQtyInput('  12abc')).toBe('12');
    expect(sanitizeLpgComposerQtyInput('abc')).toBe('');
    expect(parseLpgComposerQtyInput('')).toBe(0);
    expect(parseLpgComposerQtyInput('08')).toBe(8);
  });

  it('uses the current empty stock as the limit for dispose actions', () => {
    expect(
      resolveLpgComposerMaxQty({
        composerType: 'DISPOSE',
        selectedProductQtyEmpty: 4,
        selectedDisposedEntryAvailableQty: 99
      })
    ).toBe(4);
  });

  it('uses the remaining available disposed quantity for replace or junk actions', () => {
    expect(
      resolveLpgComposerMaxQty({
        composerType: 'REPLACE',
        selectedProductQtyEmpty: 4,
        selectedDisposedEntryAvailableQty: 2
      })
    ).toBe(2);
  });
});
