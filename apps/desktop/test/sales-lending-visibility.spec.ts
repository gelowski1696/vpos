import * as SalesScreenModule from '../src/screens/SalesScreen';

describe('resolveSaleLineFlowValue', () => {
  it('reads refill flow from legacy cylinder_flow payloads', () => {
    expect(typeof (SalesScreenModule as any).resolveSaleLineFlowValue).toBe('function');

    const resolveSaleLineFlowValue = (SalesScreenModule as any).resolveSaleLineFlowValue as (
      line: Record<string, unknown> | null | undefined
    ) => string | null;

    expect(resolveSaleLineFlowValue({ cylinder_flow: 'REFILL_EXCHANGE' })).toBe('REFILL_EXCHANGE');
  });

  it('prefers the desktop camelCase field when both keys are present', () => {
    expect(typeof (SalesScreenModule as any).resolveSaleLineFlowValue).toBe('function');

    const resolveSaleLineFlowValue = (SalesScreenModule as any).resolveSaleLineFlowValue as (
      line: Record<string, unknown> | null | undefined
    ) => string | null;

    expect(
      resolveSaleLineFlowValue({
        cylinderFlow: 'NON_REFILL',
        cylinder_flow: 'REFILL_EXCHANGE'
      })
    ).toBe('NON_REFILL');
  });

  it('falls back to the sale line subtitle when flow keys are missing', () => {
    expect(typeof (SalesScreenModule as any).resolveSaleLineFlowValue).toBe('function');

    const resolveSaleLineFlowValue = (SalesScreenModule as any).resolveSaleLineFlowValue as (
      line: Record<string, unknown> | null | undefined
    ) => string | null;

    expect(
      resolveSaleLineFlowValue({
        subtitle: 'Refill | 5 kg'
      })
    ).toBe('REFILL_EXCHANGE');
  });
});
