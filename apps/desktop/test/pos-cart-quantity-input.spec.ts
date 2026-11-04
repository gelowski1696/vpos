import {
  normalizeCartQuantityDraftInput,
  parseCartQuantityDraftInput,
} from '../src/screens/PosScreen';

describe('POS cart quantity input', () => {
  it('keeps an emptied draft blank and treats it as unset on commit', () => {
    expect(normalizeCartQuantityDraftInput('')).toBe('');
    expect(normalizeCartQuantityDraftInput('0012')).toBe('12');
    expect(normalizeCartQuantityDraftInput('12ab3')).toBe('123');

    expect(parseCartQuantityDraftInput('')).toBeNull();
    expect(parseCartQuantityDraftInput('07')).toBe(7);
  });
});
