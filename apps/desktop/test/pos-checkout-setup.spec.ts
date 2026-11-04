import { readFileSync } from 'fs';
import { join } from 'path';
import { getCheckoutSetupChangeButtonClass } from '../src/screens/PosScreen';

describe('POS checkout setup change button', () => {
  it('uses the blue primary button style', () => {
    expect(getCheckoutSetupChangeButtonClass(false)).toBe('primary-btn mini-btn');
    expect(getCheckoutSetupChangeButtonClass(true)).toBe('primary-btn mini-btn tutorial-target-active');
  });

  it('keeps checkout setup sections in normal flow and centers the success eyebrow', () => {
    const css = readFileSync(join(__dirname, '../src/styles/globals.css'), 'utf8');

    expect(css).toMatch(/\.pos-static-setup-panel\s*\{[^}]*grid-template-rows:\s*auto auto auto auto;/s);
    expect(css).toMatch(/\.pos-static-setup-panel\s*\{[^}]*overflow-y:\s*auto;/s);
    expect(css).toMatch(/\.pos-sale-success-eyebrow\s*\{[^}]*text-align:\s*center;/s);
  });
});
