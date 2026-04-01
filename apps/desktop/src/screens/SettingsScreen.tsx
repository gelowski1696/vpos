import { useEffect, useMemo, useState } from 'react';
import type { DesktopAppState, DesktopOption, DesktopSetupState } from '../db/schema';
import { desktopAuthService } from '../services/desktop-auth.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopReceiptService } from '../services/desktop-receipt.service';
import { desktopSettingsService } from '../services/desktop-settings.service';

type Props = {
  state: DesktopAppState;
  onStateReload: () => Promise<void>;
};

function copySetup(setup: DesktopSetupState): DesktopSetupState {
  return { ...setup };
}

export function SettingsScreen({ state, onStateReload }: Props): JSX.Element {
  const [form, setForm] = useState<DesktopSetupState>(copySetup(state.setup));
  const [password, setPassword] = useState('');
  const [branchOptions, setBranchOptions] = useState<DesktopOption[]>([]);
  const [locationOptions, setLocationOptions] = useState<DesktopOption[]>([]);
  const [signingIn, setSigningIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [testingPrinter, setTestingPrinter] = useState(false);
  const [message, setMessage] = useState('Sign in once on this device, then refresh the local branch data for desktop POS.');

  useEffect(() => {
    setForm(copySetup(state.setup));
  }, [state.setup]);

  useEffect(() => {
    let active = true;
    async function loadBranches(): Promise<void> {
      if (!state.auth.accessToken || !form.clientId || !form.apiBaseUrl) {
        if (active) {
          setBranchOptions([]);
        }
        return;
      }
      try {
        const result = await desktopMasterDataService.fetchBranchOptions({
          ...state,
          setup: {
            ...state.setup,
            ...form
          }
        });
        if (active) {
          setBranchOptions(result.options);
        }
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : 'Unable to load branches.');
        }
      }
    }
    void loadBranches();
    return () => {
      active = false;
    };
  }, [state.auth.accessToken, form.clientId, form.apiBaseUrl, form.branchId, form.locationId]);

  useEffect(() => {
    let active = true;
    async function loadLocations(): Promise<void> {
      if (!state.auth.accessToken || !form.clientId || !form.apiBaseUrl || !form.branchId) {
        if (active) {
          setLocationOptions([]);
        }
        return;
      }
      try {
        const result = await desktopMasterDataService.fetchLocationOptions(
          {
            ...state,
            setup: {
              ...state.setup,
              ...form
            }
          },
          form.branchId
        );
        if (active) {
          setLocationOptions(result.options);
        }
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : 'Unable to load locations.');
        }
      }
    }
    void loadLocations();
    return () => {
      active = false;
    };
  }, [state.auth.accessToken, form.clientId, form.apiBaseUrl, form.branchId]);

  const branchLabel = useMemo(
    () => branchOptions.find((option) => option.id === form.branchId)?.label ?? form.branchLabel,
    [branchOptions, form.branchId, form.branchLabel]
  );
  const locationLabel = useMemo(
    () => locationOptions.find((option) => option.id === form.locationId)?.label ?? form.locationLabel,
    [locationOptions, form.locationId, form.locationLabel]
  );

  const handleSignIn = async (): Promise<void> => {
    if (!form.apiBaseUrl || !form.clientId || !form.authEmail || !password || !form.deviceId) {
      setMessage('Fill in API URL, client ID, email, password, and device ID first.');
      return;
    }

    setSigningIn(true);
    try {
      const session = await desktopAuthService.login(
        form.apiBaseUrl,
        form.authEmail,
        password,
        form.clientId,
        form.deviceId
      );
      const nextState: DesktopAppState = {
        ...state,
        setup: {
          ...state.setup,
          ...form,
          branchLabel,
          locationLabel
        },
        auth: {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          signedInAt: session.signedInAt
        },
        sync: {
          ...state.sync,
          lastSyncStatus: 'idle',
          lastSyncMessage: 'Desktop sign-in succeeded. You can now refresh branch master data.'
        }
      };
      await desktopSettingsService.saveState(nextState);
      await onStateReload();
      setPassword('');
      setMessage('Desktop sign-in succeeded. Next step: choose branch/location and refresh the local branch data.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Desktop sign-in failed.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleRefreshCatalog = async (): Promise<void> => {
    if (!state.auth.accessToken) {
      setMessage('Sign in first so the desktop app can load protected master data.');
      return;
    }
    if (!form.branchId) {
      setMessage('Choose a branch before refreshing the desktop branch data.');
      return;
    }
    setSyncingCatalog(true);
    try {
      const result = await desktopMasterDataService.syncCatalog(
        {
          ...state,
          setup: {
            ...state.setup,
            ...form
          }
        },
        form.branchId
      );
      const nextState: DesktopAppState = {
        ...result.state,
        setup: {
          ...result.state.setup,
          ...form,
          branchLabel,
          locationLabel
        },
        sync: {
          lastSyncedAt: result.syncedAt,
          lastSyncStatus: 'success',
          lastSyncMessage: `Desktop branch data refreshed. ${result.productCount} products and ${result.customerCount} customers were cached locally.`
        }
      };
      await desktopSettingsService.saveState(nextState);
      await onStateReload();
      setMessage(`Branch data refreshed. ${result.productCount} products and ${result.customerCount} customers are now available offline on this desktop.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unable to refresh branch data.';
      const nextState: DesktopAppState = {
        ...state,
        sync: {
          lastSyncedAt: new Date().toISOString(),
          lastSyncStatus: 'error',
          lastSyncMessage: detail
        }
      };
      await desktopSettingsService.saveState(nextState);
      await onStateReload();
      setMessage(detail);
    } finally {
      setSyncingCatalog(false);
    }
  };

  const handleTestPrinter = async (): Promise<void> => {
    setTestingPrinter(true);
    try {
      const draftState: DesktopAppState = {
        ...state,
        setup: {
          ...state.setup,
          ...form,
          branchLabel,
          locationLabel
        }
      };
      await desktopReceiptService.testPrinter(draftState);
      setMessage('Printer test was sent. If nothing came out, check the selected USB printer name or LAN host and port.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to run printer test on this desktop station.');
    } finally {
      setTestingPrinter(false);
    }
  };

  const handleSaveSetup = async (): Promise<void> => {
    setSaving(true);
    try {
      await desktopSettingsService.completeSetup({
        ...form,
        branchLabel,
        locationLabel
      });
      await onStateReload();
      setMessage('Desktop setup saved. The POS screen will now use your selected branch and local product/customer cache.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen-stack">
      <section className="panel-card">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Desktop setup</div>
            <h3>Branch, auth, catalog sync, and printer path</h3>
          </div>
        </div>

        <div className="form-grid">
          <label>
            <span>Operator name</span>
            <input
              value={form.operatorName}
              onChange={(event) => setForm((prev) => ({ ...prev, operatorName: event.target.value }))}
              placeholder="Cashier or operator"
            />
          </label>
          <label>
            <span>API base URL</span>
            <input
              value={form.apiBaseUrl}
              onChange={(event) => setForm((prev) => ({ ...prev, apiBaseUrl: event.target.value }))}
              placeholder="https://vmjamtech.com/api"
            />
          </label>
          <label>
            <span>Tenant client ID</span>
            <input
              value={form.clientId}
              onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))}
              placeholder="DEMO or tenant code"
            />
          </label>
          <label>
            <span>Desktop sign-in email</span>
            <input
              value={form.authEmail}
              onChange={(event) => setForm((prev) => ({ ...prev, authEmail: event.target.value }))}
              placeholder="cashier@branch.local"
            />
          </label>
          <label>
            <span>Desktop sign-in password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
            />
          </label>
          <label>
            <span>Device ID</span>
            <input
              value={form.deviceId}
              onChange={(event) => setForm((prev) => ({ ...prev, deviceId: event.target.value }))}
              placeholder="desktop-main-counter"
            />
          </label>
          <label>
            <span>Branch</span>
            <select
              value={form.branchId}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  branchId: event.target.value,
                  branchLabel: branchOptions.find((option) => option.id === event.target.value)?.label ?? '',
                  locationId: '',
                  locationLabel: ''
                }))
              }
            >
              <option value="">Select branch</option>
              {branchOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Location</span>
            <select
              value={form.locationId}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  locationId: event.target.value,
                  locationLabel: locationOptions.find((option) => option.id === event.target.value)?.label ?? ''
                }))
              }
            >
              <option value="">Select location</option>
              {locationOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Printer mode</span>
            <select
              value={form.printerMode}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  printerMode: event.target.value as DesktopSetupState['printerMode']
                }))
              }
            >
              <option value="USB">USB</option>
              <option value="LAN">LAN</option>
              <option value="NONE">None Yet</option>
            </select>
          </label>
          <label>
            <span>USB printer name</span>
            <input
              value={form.printerName}
              onChange={(event) => setForm((prev) => ({ ...prev, printerName: event.target.value }))}
              placeholder="EPSON TM-T82X Receipt"
            />
          </label>
          <label>
            <span>LAN printer host</span>
            <input
              value={form.printerHost}
              onChange={(event) => setForm((prev) => ({ ...prev, printerHost: event.target.value }))}
              placeholder="192.168.1.120"
            />
          </label>
          <label>
            <span>LAN printer port</span>
            <input
              value={form.printerPort}
              onChange={(event) => setForm((prev) => ({ ...prev, printerPort: event.target.value }))}
              placeholder="9100"
            />
          </label>
        </div>

        <div className="note-panel">
          <strong>Desktop setup order</strong>
          <p>Sign in first, then choose the branch and location, refresh branch data, run a printer test, and save this workstation.</p>
        </div>

        <div className="action-row desktop-settings-actions">
          <button className="secondary-btn" type="button" onClick={() => void handleSignIn()} disabled={signingIn}>
            {signingIn ? 'Signing In...' : 'Sign In'}
          </button>
          <button
            className="secondary-btn"
            type="button"
            onClick={() => void handleRefreshCatalog()}
            disabled={syncingCatalog || !state.auth.accessToken}
          >
            {syncingCatalog ? 'Refreshing Branch Data...' : 'Refresh Branch Data'}
          </button>
          <button
            className="secondary-btn"
            type="button"
            onClick={() => void handleTestPrinter()}
            disabled={testingPrinter || form.printerMode === 'NONE'}
          >
            {testingPrinter ? 'Testing Printer...' : 'Test Printer'}
          </button>
          <button className="primary-btn" type="button" onClick={() => void handleSaveSetup()} disabled={saving}>
            {saving ? 'Saving Setup...' : 'Save Desktop Setup'}
          </button>
        </div>

        <div className="message-banner">{message}</div>
      </section>
    </div>
  );
}
