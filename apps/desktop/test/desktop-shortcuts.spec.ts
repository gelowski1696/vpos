import { resolveFunctionKey } from '../src/hooks/useDesktopShortcuts';

describe('resolveFunctionKey', () => {
  it('reads function key from KeyboardEvent.key', () => {
    expect(resolveFunctionKey({ key: 'F1', code: '', keyCode: 0, which: 0 } as KeyboardEvent)).toBe('F1');
    expect(resolveFunctionKey({ key: 'f2', code: '', keyCode: 0, which: 0 } as KeyboardEvent)).toBe('F2');
  });

  it('falls back to KeyboardEvent.code', () => {
    expect(resolveFunctionKey({ key: 'Unidentified', code: 'F3', keyCode: 0, which: 0 } as KeyboardEvent)).toBe('F3');
  });

  it('falls back to legacy keyCode and which', () => {
    expect(resolveFunctionKey({ key: '', code: '', keyCode: 115, which: 0 } as KeyboardEvent)).toBe('F4');
    expect(resolveFunctionKey({ key: '', code: '', keyCode: 0, which: 123 } as KeyboardEvent)).toBe('F12');
  });

  it('returns null for non function keys', () => {
    expect(resolveFunctionKey({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 } as KeyboardEvent)).toBeNull();
  });
});
