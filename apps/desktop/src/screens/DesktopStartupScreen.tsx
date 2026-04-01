import { useEffect, useMemo, useState } from 'react';
import { QuickSetupQrModal } from '../components/setup/QuickSetupQrModal';
import type { DesktopAppState, DesktopOption, DesktopSetupState } from '../db/schema';
import type { DesktopStartupStage } from '../services/desktop-session.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';

type Props = {
  state: DesktopAppState;
  stage: DesktopStartupStage;
  busy: boolean;
  message: string;
  error: string | null;
  hasPinConfigured: boolean;
  onLogin: (input: DesktopSetupState & { password: string; pin: string }) => Promise<void>;
  onUnlock: (pin: string) => Promise<void>;
  onDownloadSetup: (setup: DesktopSetupState) => Promise<void>;
  onQuickSetup: (input: { token: string; pin: string; apiBaseUrl: string; deviceId: string; operatorName: string }) => Promise<void>;
  onSwitchToLogin: () => void;
  onSwitchToPin: () => void;
};

function copySetup(setup: DesktopSetupState): DesktopSetupState {
  return { ...setup };
}

export function DesktopStartupScreen({
  state,
  stage,
  busy,
  message,
  error,
  hasPinConfigured,
  onLogin,
  onUnlock,
  onDownloadSetup,
  onQuickSetup,
  onSwitchToLogin,
  onSwitchToPin
}: Props): JSX.Element {
  const [form, setForm] = useState<DesktopSetupState>(copySetup(state.setup));
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [showQrModal, setShowQrModal] = useState(false);
  const [branchOptions, setBranchOptions] = useState<DesktopOption[]>([]);
  const [locationOptions, setLocationOptions] = useState<DesktopOption[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [optionMessage, setOptionMessage] = useState<string | null>(null);

  useEffect(() => {
    setForm(copySetup(state.setup));
  }, [state.setup]);

  useEffect(() => {
    let active = true;
    async function loadBranches(): Promise<void> {
      if (stage !== 'SETUP' || !state.auth.accessToken || !form.clientId || !form.apiBaseUrl) {
        if (active) {
          setBranchOptions([]);
        }
        return;
      }
      setLoadingBranches(true);
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
          setOptionMessage(null);
        }
      } catch (cause) {
        if (active) {
          setOptionMessage(cause instanceof Error ? cause.message : 'Unable to load branches.');
        }
      } finally {
        if (active) {
          setLoadingBranches(false);
        }
      }
    }
    void loadBranches();
    return () => {
      active = false;
    };
  }, [stage, state.auth.accessToken, state.auth.refreshToken, state.setup, form.clientId, form.apiBaseUrl]);

  useEffect(() => {
    let active = true;
    async function loadLocations(): Promise<void> {
      if (stage !== 'SETUP' || !state.auth.accessToken || !form.clientId || !form.apiBaseUrl || !form.branchId) {
        if (active) {
          setLocationOptions([]);
        }
        return;
      }
      setLoadingLocations(true);
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
          setOptionMessage(null);
        }
      } catch (cause) {
        if (active) {
          setOptionMessage(cause instanceof Error ? cause.message : 'Unable to load locations.');
        }
      } finally {
        if (active) {
          setLoadingLocations(false);
        }
      }
    }
    void loadLocations();
    return () => {
      active = false;
    };
  }, [stage, state.auth.accessToken, state.auth.refreshToken, state.setup, form.clientId, form.apiBaseUrl, form.branchId]);

  const stageTitle = useMemo(() => {
    if (stage === 'UNLOCK') {
      return 'Unlock VPOS Desktop';
    }
    if (stage === 'SETUP') {
      return 'Download Branch Data';
    }
    return 'Sign In To This Workstation';
  }, [stage]);

  const stageHint = useMemo(() => {
    if (stage === 'UNLOCK') {
      return 'Use your saved device PIN to reopen this cashier station quickly.';
    }
    if (stage === 'SETUP') {
      return 'Choose the branch and location for this workstation, then download products, customers, and lending data.';
    }
    return 'Use password sign-in or a QR quick setup, then finish the same branch download flow the mobile app uses.';
  }, [stage]);

  const branchLabel = branchOptions.find((option) => option.id === form.branchId)?.label ?? form.branchLabel;
  const locationLabel = locationOptions.find((option) => option.id === form.locationId)?.label ?? form.locationLabel;

  return (
    <>
      <div className="desktop-startup-shell">
        <section className="desktop-startup-card">
          <div className="brand-block startup-brand-block">
            <div className="brand-mark">VP</div>
            <div>
              <div className="brand-title">VPOS Desktop</div>
              <div className="brand-hint">Branch workstation setup and cashier access</div>
            </div>
          </div>

          <div className="panel-head">
            <div>
              <div className="eyebrow">Desktop startup</div>
              <h2>{stageTitle}</h2>
              <p>{stageHint}</p>
            </div>
          </div>

          {stage === 'LOGIN' ? (
            <div className="startup-auth-stack">
              <div className="startup-mobile-card">
                <input
                  value={form.authEmail}
                  onChange={(event) => setForm((prev) => ({ ...prev, authEmail: event.target.value }))}
                  placeholder="Email"
                  autoComplete="off"
                  disabled={busy}
                />
                <div className="startup-helper-copy">Use your web admin email address.</div>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  autoComplete="off"
                  disabled={busy}
                />
                <div className="startup-helper-copy">PIN is optional here and can be used for quick unlock later.</div>
                <input
                  type="password"
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  placeholder="PIN (optional)"
                  inputMode="numeric"
                  disabled={busy}
                />
              </div>

              <div className="desktop-settings-actions startup-auth-actions">
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => void onLogin({ ...form, password, pin })}
                  disabled={busy}
                >
                  {busy ? 'Signing In...' : 'Sign In'}
                </button>
                <button className="secondary-btn" type="button" onClick={() => setShowQrModal(true)} disabled={busy}>
                  QR Quick Setup
                </button>
                {hasPinConfigured ? (
                  <button className="secondary-btn" type="button" onClick={onSwitchToPin} disabled={busy}>
                    Use PIN Instead
                  </button>
                ) : null}
              </div>

              <details className="startup-advanced-details">
                <summary>Workstation details</summary>
                <div className="startup-advanced-grid">
                  <input
                    value={form.operatorName}
                    onChange={(event) => setForm((prev) => ({ ...prev, operatorName: event.target.value }))}
                    placeholder="Operator name"
                    disabled={busy}
                  />
                  <input
                    value={form.apiBaseUrl}
                    onChange={(event) => setForm((prev) => ({ ...prev, apiBaseUrl: event.target.value }))}
                    placeholder="API base URL"
                    disabled={busy}
                  />
                  <input
                    value={form.clientId}
                    onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))}
                    placeholder="Tenant client ID"
                    disabled={busy}
                  />
                  <input
                    value={form.deviceId}
                    onChange={(event) => setForm((prev) => ({ ...prev, deviceId: event.target.value }))}
                    placeholder="Device ID"
                    disabled={busy}
                  />
                </div>
              </details>
            </div>
          ) : null}

          {stage === 'UNLOCK' ? (
            <div className="startup-auth-stack">
              <div className="unlock-card">
                <strong>{state.auth.userFullName || state.auth.userEmail || 'Saved cashier session'}</strong>
                <span>Enter your saved PIN to continue.</span>
              </div>
              <div className="startup-mobile-card">
                <input
                  type="password"
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  placeholder="PIN"
                  inputMode="numeric"
                  disabled={busy}
                />
                <div className="startup-helper-copy">Ask a supervisor to reset the PIN if it was forgotten.</div>
              </div>
              <div className="desktop-settings-actions startup-auth-actions">
                <button className="primary-btn" type="button" onClick={() => void onUnlock(pin)} disabled={busy}>
                  {busy ? 'Unlocking...' : 'Unlock'}
                </button>
                <button className="secondary-btn" type="button" onClick={onSwitchToLogin} disabled={busy}>
                  Use Password Instead
                </button>
              </div>
            </div>
          ) : null}

          {stage === 'SETUP' ? (
            <div className="screen-stack">
              <div className="sync-banner success">
                <strong>{state.auth.userFullName || state.auth.userEmail || form.authEmail || 'Cashier signed in'}</strong>
                <span>Choose branch and location, then download local data.</span>
              </div>

              <div className="startup-mobile-card">
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
                  disabled={busy || loadingBranches}
                >
                  <option value="">{loadingBranches ? 'Loading branches...' : 'Select branch'}</option>
                  {branchOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  value={form.locationId}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      locationId: event.target.value,
                      locationLabel: locationOptions.find((option) => option.id === event.target.value)?.label ?? ''
                    }))
                  }
                  disabled={busy || loadingLocations || !form.branchId}
                >
                  <option value="">{loadingLocations ? 'Loading locations...' : 'Select location'}</option>
                  {locationOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="startup-helper-copy">
                  Products, customers, price rules, inventory, and lending records for {branchLabel || 'the selected branch'} will be cached locally.
                </div>
              </div>

              <div className="desktop-settings-actions startup-auth-actions">
                <button className="primary-btn" type="button" onClick={() => void onDownloadSetup({ ...form, branchLabel, locationLabel })} disabled={busy}>
                  {busy ? 'Downloading Branch Data...' : 'Download And Continue'}
                </button>
              </div>

              <details className="startup-advanced-details">
                <summary>Workstation details</summary>
                <div className="startup-advanced-grid">
                  <input
                    value={form.apiBaseUrl}
                    onChange={(event) => setForm((prev) => ({ ...prev, apiBaseUrl: event.target.value }))}
                    placeholder="API base URL"
                    disabled={busy}
                  />
                  <input
                    value={form.operatorName}
                    onChange={(event) => setForm((prev) => ({ ...prev, operatorName: event.target.value }))}
                    placeholder="Operator name"
                    disabled={busy}
                  />
                  <input
                    value={form.clientId}
                    onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))}
                    placeholder="Tenant client ID"
                    disabled={busy}
                  />
                  <input
                    value={form.deviceId}
                    onChange={(event) => setForm((prev) => ({ ...prev, deviceId: event.target.value }))}
                    placeholder="Device ID"
                    disabled={busy}
                  />
                </div>
              </details>
            </div>
          ) : null}

          <div className={`message-banner ${error ? 'startup-error-banner' : ''}`}>
            {error || optionMessage || message}
          </div>
        </section>
      </div>

      <QuickSetupQrModal
        open={showQrModal}
        busy={busy}
        onClose={() => setShowQrModal(false)}
        onSubmit={async ({ token, pin: qrPin }) => {
          await onQuickSetup({
            token,
            pin: qrPin,
            apiBaseUrl: form.apiBaseUrl,
            deviceId: form.deviceId,
            operatorName: form.operatorName
          });
          setShowQrModal(false);
        }}
      />
    </>
  );
}
