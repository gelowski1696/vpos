import { DEFAULT_DESKTOP_APP_STATE } from '../src/db/schema';
import { prepareStartupSetup, updateLoginEmail } from '../src/screens/desktop-login-tenant';

describe('desktop startup tenant switching', () => {
  it('starts password login without a previously saved tenant binding', () => {
    const setup = {
      ...DEFAULT_DESKTOP_APP_STATE.setup,
      authEmail: 'cashier@cashier.com',
      clientId: 'CASHIER_TENANT'
    };

    expect(prepareStartupSetup(setup, 'LOGIN').clientId).toBe('');
    expect(prepareStartupSetup(setup, 'SETUP').clientId).toBe('CASHIER_TENANT');
  });

  it('clears a saved tenant client ID when the cashier email changes', () => {
    const setup = {
      ...DEFAULT_DESKTOP_APP_STATE.setup,
      authEmail: 'cashier@cashier.com',
      clientId: 'CASHIER_TENANT'
    };

    expect(updateLoginEmail(setup, 'cashier@tester.com')).toEqual(
      expect.objectContaining({
        authEmail: 'cashier@tester.com',
        clientId: ''
      })
    );
  });

  it('keeps an explicitly entered tenant client ID when the email is unchanged', () => {
    const setup = {
      ...DEFAULT_DESKTOP_APP_STATE.setup,
      authEmail: 'cashier@tester.com',
      clientId: 'TESTER_TENANT'
    };

    expect(updateLoginEmail(setup, 'CASHIER@TESTER.COM').clientId).toBe('TESTER_TENANT');
  });
});
