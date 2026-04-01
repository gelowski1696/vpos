import { useEffect, useMemo, useState } from 'react';
import type {
  DesktopAppState,
  DesktopOption,
  DesktopPrinterProfile,
  DesktopSetupState
} from '../db/schema';
import { desktopAuthService } from '../services/desktop-auth.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { listNativePrinters } from '../services/desktop-printer.bridge';
import { desktopReceiptService } from '../services/desktop-receipt.service';
import { desktopSettingsService } from '../services/desktop-settings.service';

type Props = {
  state: DesktopAppState;
  onStateReload: () => Promise<void>;
};

function copySetup(setup: DesktopSetupState): DesktopSetupState {
  return { ...setup };
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return 'Not tested yet';
  }
  return new Date(value).toLocaleString();
}

function copyProfileToSetup(profile: DesktopPrinterProfile, setup: DesktopSetupState): DesktopSetupState {
  return {
    ...setup,
    printerMode: profile.mode,
    printerName: profile.printerName,
    printerHost: profile.printerHost,
    printerPort: profile.printerPort
  };
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
  const [discoveringPrinters, setDiscoveringPrinters] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [discoveredPrinters, setDiscoveredPrinters] = useState<string[]>([]);
  const [profileLabel, setProfileLabel] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
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

  const selectedProfile = state.printerProfiles.find((profile) => profile.id === selectedProfileId) ?? null;

  const buildProfile = (existing?: DesktopPrinterProfile | null): DesktopPrinterProfile => ({
    id: existing?.id ?? `printer-profile-${Date.now()}`,
    label: profileLabel.trim(),
    mode: form.printerMode === 'LAN' ? 'LAN' : 'USB',
    printerName: form.printerName,
    printerHost: form.printerHost,
    printerPort: form.printerPort,
    lastTestedAt: existing?.lastTestedAt ?? null,
    lastSuccessAt: existing?.lastSuccessAt ?? null,
    lastTestStatus: existing?.lastTestStatus ?? 'idle',
    lastTestMessage: existing?.lastTestMessage ?? null
  });

  const saveProfilesState = async (profiles: DesktopPrinterProfile[], syncMessage?: string): Promise<void> => {
    const current = await desktopSettingsService.getState();
    const nextState: DesktopAppState = {
      ...current,
      setup: {
        ...current.setup,
        ...form,
        branchLabel,
        locationLabel
      },
      printerProfiles: profiles,
      sync: syncMessage
        ? {
            ...current.sync,
            lastSyncMessage: syncMessage
          }
        : current.sync
    };
    await desktopSettingsService.saveState(nextState);
    await onStateReload();
  };

  const persistProfile = async (): Promise<DesktopPrinterProfile | null> => {
    const trimmed = profileLabel.trim();
    if (!trimmed) {
      setMessage('Enter a printer profile name first.');
      return null;
    }
    if (form.printerMode === 'NONE') {
      setMessage('Choose USB or LAN before saving a printer profile.');
      return null;
    }
    if (form.printerMode === 'USB' && !form.printerName.trim()) {
      setMessage('Select or enter a USB printer name before saving this profile.');
      return null;
    }
    if (form.printerMode === 'LAN' && !form.printerHost.trim()) {
      setMessage('Enter the LAN printer host before saving this profile.');
      return null;
    }

    setSavingProfile(true);
    try {
      const current = await desktopSettingsService.getState();
      const existing = current.printerProfiles.find((entry) => entry.id === selectedProfileId) ??
        current.printerProfiles.find((entry) => entry.label.toLowerCase() === trimmed.toLowerCase()) ??
        null;
      const profile = buildProfile(existing);
      const nextProfiles = [...current.printerProfiles.filter((entry) => entry.id !== profile.id && entry.label.toLowerCase() !== trimmed.toLowerCase()), profile];
      await saveProfilesState(nextProfiles, `Saved printer profile "${profile.label}" for this desktop station.`);
      setSelectedProfileId(profile.id);
      setMessage(`Saved printer profile "${profile.label}" for this desktop station.`);
      return profile;
    } finally {
      setSavingProfile(false);
    }
  };

  const recordPrinterTestResult = async (
    profileId: string | null,
    success: boolean,
    resultMessage: string
  ): Promise<void> => {
    if (!profileId) {
      return;
    }
    const current = await desktopSettingsService.getState();
    const testedAt = new Date().toISOString();
    const nextProfiles = current.printerProfiles.map((profile) =>
      profile.id === profileId
        ? {
            ...profile,
            lastTestedAt: testedAt,
            lastSuccessAt: success ? testedAt : profile.lastSuccessAt,
            lastTestStatus: (success ? 'success' : 'error') as DesktopPrinterProfile['lastTestStatus'],
            lastTestMessage: resultMessage
          }
        : profile
    );
    await saveProfilesState(nextProfiles);
  };

  const runPrinterTest = async (overrideProfile?: DesktopPrinterProfile | null): Promise<void> => {
    setTestingPrinter(true);
    const draftState: DesktopAppState = {
      ...state,
      setup: {
        ...state.setup,
        ...form,
        ...(overrideProfile ? copyProfileToSetup(overrideProfile, form) : {}),
        branchLabel,
        locationLabel
      }
    };
    try {
      await desktopReceiptService.testPrinter(draftState);
      const successMessage = overrideProfile
        ? `Printer test was sent using "${overrideProfile.label}".`
        : 'Printer test was sent. If nothing came out, check the selected USB printer name or LAN host and port.';
      await recordPrinterTestResult(overrideProfile?.id ?? (selectedProfileId || null), true, successMessage);
      setMessage(successMessage);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to run printer test on this desktop station.';
      await recordPrinterTestResult(overrideProfile?.id ?? (selectedProfileId || null), false, errorMessage);
      setMessage(errorMessage);
    } finally {
      setTestingPrinter(false);
    }
  };

  const handleSignIn = async (): Promise<void> => {
    if (!form.apiBaseUrl || !form.clientId || !form.authEmail || !password || !form.deviceId) {
      setMessage('Fill in API URL, client ID, email, password, and device ID first.');
      return;
    }

    setSigningIn(true);
    try {
      const session = await desktopAuthService.login(form.apiBaseUrl, form.authEmail, password, form.clientId, form.deviceId);
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
      setMessage(
        `Branch data refreshed. ${result.productCount} products, ${result.customerCount} customers, and ${result.lendingCount} lending records are now available offline on this desktop.`
      );
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

  const handleDiscoverPrinters = async (): Promise<void> => {
    setDiscoveringPrinters(true);
    try {
      const printers = await listNativePrinters();
      setDiscoveredPrinters(printers);
      setMessage(
        printers.length > 0
          ? `Found ${printers.length} installed printer${printers.length === 1 ? '' : 's'} on this desktop station.`
          : 'No installed printers were discovered on this desktop station.'
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to discover installed printers on this desktop.');
    } finally {
      setDiscoveringPrinters(false);
    }
  };

  const applyProfile = (profile: DesktopPrinterProfile): void => {
    setForm((prev) => copyProfileToSetup(profile, prev));
    setProfileLabel(profile.label);
    setSelectedProfileId(profile.id);
    setMessage(`Applied printer profile "${profile.label}" to this desktop setup form.`);
  };

  const handleDeletePrinterProfile = async (profileId: string): Promise<void> => {
    const current = await desktopSettingsService.getState();
    const nextProfiles = current.printerProfiles.filter((entry) => entry.id !== profileId);
    await saveProfilesState(nextProfiles);
    if (selectedProfileId === profileId) {
      setSelectedProfileId('');
    }
    setMessage('Removed the selected printer profile from this desktop station.');
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
            <input value={form.operatorName} onChange={(event) => setForm((prev) => ({ ...prev, operatorName: event.target.value }))} placeholder="Cashier or operator" />
          </label>
          <label>
            <span>API base URL</span>
            <input value={form.apiBaseUrl} onChange={(event) => setForm((prev) => ({ ...prev, apiBaseUrl: event.target.value }))} placeholder="https://vmjamtech.com/api" />
          </label>
          <label>
            <span>Tenant client ID</span>
            <input value={form.clientId} onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))} placeholder="DEMO or tenant code" />
          </label>
          <label>
            <span>Desktop sign-in email</span>
            <input value={form.authEmail} onChange={(event) => setForm((prev) => ({ ...prev, authEmail: event.target.value }))} placeholder="cashier@branch.local" />
          </label>
          <label>
            <span>Desktop sign-in password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" />
          </label>
          <label>
            <span>Device ID</span>
            <input value={form.deviceId} onChange={(event) => setForm((prev) => ({ ...prev, deviceId: event.target.value }))} placeholder="desktop-main-counter" />
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
        </div>

        <div className="note-panel">
          <strong>Desktop setup order</strong>
          <p>Sign in first, then choose the branch and location, refresh branch data, walk through the printer setup steps below, and save this workstation.</p>
        </div>

        <div className="action-row desktop-settings-actions">
          <button className="secondary-btn" type="button" onClick={() => void handleSignIn()} disabled={signingIn}>
            {signingIn ? 'Signing In...' : 'Sign In'}
          </button>
          <button className="secondary-btn" type="button" onClick={() => void handleRefreshCatalog()} disabled={syncingCatalog || !state.auth.accessToken}>
            {syncingCatalog ? 'Refreshing Branch Data...' : 'Refresh Branch Data'}
          </button>
          <button className="primary-btn" type="button" onClick={() => void handleSaveSetup()} disabled={saving}>
            {saving ? 'Saving Setup...' : 'Save Desktop Setup'}
          </button>
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Printer setup wizard</div>
            <h3>Save, test, and reuse desktop printer paths</h3>
          </div>
        </div>

        <div className="wizard-grid">
          <section className="wizard-step-card">
            <div className="wizard-step-number">1</div>
            <div>
              <strong>Choose printer path</strong>
              <p>Pick whether this workstation prints through USB or directly to a LAN receipt printer.</p>
            </div>
            <label>
              <span>Printer mode</span>
              <select value={form.printerMode} onChange={(event) => setForm((prev) => ({ ...prev, printerMode: event.target.value as DesktopSetupState['printerMode'] }))}>
                <option value="USB">USB</option>
                <option value="LAN">LAN</option>
                <option value="NONE">None Yet</option>
              </select>
            </label>
          </section>

          <section className="wizard-step-card">
            <div className="wizard-step-number">2</div>
            <div>
              <strong>Enter printer connection</strong>
              <p>Discover local USB printers or enter the LAN IP and port for the printer you want this station to use.</p>
            </div>
            <div className="form-grid compact-grid">
              <label>
                <span>USB printer name</span>
                <input value={form.printerName} onChange={(event) => setForm((prev) => ({ ...prev, printerName: event.target.value }))} placeholder="EPSON TM-T82X Receipt" />
              </label>
              <label>
                <span>Discovered USB printers</span>
                <select value={form.printerName} onChange={(event) => setForm((prev) => ({ ...prev, printerName: event.target.value }))}>
                  <option value="">Select discovered printer</option>
                  {discoveredPrinters.map((printer) => (
                    <option key={printer} value={printer}>
                      {printer}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>LAN printer host</span>
                <input value={form.printerHost} onChange={(event) => setForm((prev) => ({ ...prev, printerHost: event.target.value }))} placeholder="192.168.1.120" />
              </label>
              <label>
                <span>LAN printer port</span>
                <input value={form.printerPort} onChange={(event) => setForm((prev) => ({ ...prev, printerPort: event.target.value }))} placeholder="9100" />
              </label>
            </div>
            <div className="desktop-settings-actions">
              <button className="secondary-btn mini-btn" type="button" onClick={() => void handleDiscoverPrinters()} disabled={discoveringPrinters}>
                {discoveringPrinters ? 'Discovering...' : 'Discover USB Printers'}
              </button>
              <button className="secondary-btn mini-btn" type="button" onClick={() => void runPrinterTest()} disabled={testingPrinter || form.printerMode === 'NONE'}>
                {testingPrinter ? 'Testing...' : 'Test Current Path'}
              </button>
            </div>
          </section>

          <section className="wizard-step-card">
            <div className="wizard-step-number">3</div>
            <div>
              <strong>Save and validate profile</strong>
              <p>Give the setup a name, save it for reuse, and keep a last-success stamp so staff know which profile worked most recently.</p>
            </div>
            <label>
              <span>Printer profile name</span>
              <input value={profileLabel} onChange={(event) => setProfileLabel(event.target.value)} placeholder="Front Counter USB or Warehouse LAN" />
            </label>
            <div className="desktop-settings-actions">
              <button className="secondary-btn mini-btn" type="button" onClick={() => void persistProfile()} disabled={savingProfile || form.printerMode === 'NONE'}>
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </button>
              <button
                className="primary-btn mini-btn"
                type="button"
                onClick={async () => {
                  const profile = await persistProfile();
                  if (profile) {
                    await runPrinterTest(profile);
                  }
                }}
                disabled={savingProfile || testingPrinter || form.printerMode === 'NONE'}
              >
                {testingPrinter ? 'Testing...' : 'Save & Test Profile'}
              </button>
            </div>
            {selectedProfile ? (
              <div className={`sync-banner ${selectedProfile.lastTestStatus === 'error' ? 'error' : selectedProfile.lastTestStatus === 'success' ? 'success' : ''}`}>
                <strong>Selected profile status</strong>
                <span>Last test: {formatDateTime(selectedProfile.lastTestedAt)}</span>
                <span>Last success: {formatDateTime(selectedProfile.lastSuccessAt)}</span>
                <span>{selectedProfile.lastTestMessage || 'No printer feedback recorded yet.'}</span>
              </div>
            ) : null}
          </section>
        </div>

        <section className="panel-card embedded-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Saved printer profiles</div>
              <h3>Reusable desktop printer paths</h3>
            </div>
          </div>
          <div className="recent-sales-list">
            {state.printerProfiles.length === 0 ? (
              <div className="empty-state">No saved printer profiles yet. Save one after choosing a USB or LAN printer path.</div>
            ) : (
              state.printerProfiles.map((profile) => (
                <article key={profile.id} className={`recent-sale-card ${selectedProfileId === profile.id ? 'selected-card' : ''}`}>
                  <button type="button" className="card-fill-button" onClick={() => applyProfile(profile)}>
                    <div>
                      <strong>{profile.label}</strong>
                      <span>
                        {profile.mode === 'USB'
                          ? profile.printerName || 'USB printer name not set'
                          : `${profile.printerHost || 'LAN host not set'}:${profile.printerPort || '9100'}`}
                      </span>
                    </div>
                    <div>
                      <strong>{profile.mode}</strong>
                      <span>Last success: {formatDateTime(profile.lastSuccessAt)}</span>
                    </div>
                    <div className={`sync-chip ${profile.lastTestStatus === 'error' ? 'failed' : profile.lastTestStatus === 'success' ? 'synced' : 'pending'}`}>
                      {profile.lastTestStatus === 'idle' ? 'not tested' : profile.lastTestStatus}
                    </div>
                  </button>
                  <div className="recent-sale-actions">
                    <button className="secondary-btn mini-btn" type="button" onClick={() => applyProfile(profile)}>
                      Apply
                    </button>
                    <button className="secondary-btn mini-btn" type="button" onClick={() => void runPrinterTest(profile)} disabled={testingPrinter}>
                      Test Again
                    </button>
                    <button className="secondary-btn mini-btn" type="button" onClick={() => void handleDeletePrinterProfile(profile.id)}>
                      Delete
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <div className="message-banner">{message}</div>
      </section>
    </div>
  );
}
