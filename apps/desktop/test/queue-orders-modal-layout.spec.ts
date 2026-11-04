import { QUEUE_ORDERS_MODAL_CARD_STYLE } from '../src/screens/PosScreen';

describe('Queue orders modal layout', () => {
  it('uses a wider but denser modal shell', () => {
    expect(QUEUE_ORDERS_MODAL_CARD_STYLE.width).toBe('min(1680px, calc(100vw - 20px))');
    expect(QUEUE_ORDERS_MODAL_CARD_STYLE.maxWidth).toBe('min(1680px, calc(100vw - 20px))');
    expect(QUEUE_ORDERS_MODAL_CARD_STYLE['--modal-gap']).toBe('12px');
    expect(QUEUE_ORDERS_MODAL_CARD_STYLE['--modal-padding']).toBe('14px');
    expect(QUEUE_ORDERS_MODAL_CARD_STYLE['--modal-header-padding-y']).toBe('14px');
    expect(QUEUE_ORDERS_MODAL_CARD_STYLE['--modal-header-padding-x']).toBe('16px');
    expect(QUEUE_ORDERS_MODAL_CARD_STYLE['--modal-footer-padding-y']).toBe('12px');
    expect(QUEUE_ORDERS_MODAL_CARD_STYLE['--modal-footer-padding-x']).toBe('16px');
  });
});
