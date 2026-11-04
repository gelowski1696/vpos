import { parseNonNegativeDecimalInput, sanitizeDecimalInput } from '../src/screens/PosScreen';

describe('POS discount amount input', () => {
  it('removes letters and symbols so words are not accepted', () => {
    expect(sanitizeDecimalInput('abc')).toBe('');
    expect(sanitizeDecimalInput('12ab3')).toBe('123');
    expect(sanitizeDecimalInput('x-1y2.3z4')).toBe('12.34');
  });

  it('keeps a valid decimal amount with max two fraction digits', () => {
    expect(sanitizeDecimalInput('0010.999')).toBe('10.99');
    expect(sanitizeDecimalInput('.5')).toBe('0.5');
    expect(sanitizeDecimalInput('5.')).toBe('5.');
  });

  it('parses sanitized values as non-negative amounts', () => {
    expect(parseNonNegativeDecimalInput('abc')).toBe(0);
    expect(parseNonNegativeDecimalInput('0.00')).toBe(0);
    expect(parseNonNegativeDecimalInput('125.5')).toBe(125.5);
    expect(parseNonNegativeDecimalInput('125.567')).toBe(125.56);
  });

  it('enforces numeric-only behavior for paid amount and delivery fee style inputs', () => {
    expect(sanitizeDecimalInput('-1x2.3y4')).toBe('12.34');
    expect(sanitizeDecimalInput('PHP 99.9a9')).toBe('99.99');
    expect(parseNonNegativeDecimalInput('-50')).toBe(50);
    expect(parseNonNegativeDecimalInput('1,250.255')).toBe(1250.25);
  });
});
