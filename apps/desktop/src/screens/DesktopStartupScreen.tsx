import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { BrandLogo } from '../components/layout/BrandLogo';
import { playDesktopStartupCueOnce } from '../components/feedback/desktop-startup-cue';
import { QuickSetupQrModal } from '../components/setup/QuickSetupQrModal';
import type { DesktopAppState, DesktopOption, DesktopSetupState } from '../db/schema';
import type { DesktopStartupStage } from '../services/desktop-session.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { prepareStartupSetup, updateLoginEmail } from './desktop-login-tenant';

type Props = {
  state: DesktopAppState;
  stage: DesktopStartupStage;
  busy: boolean;
  message: string;
  messageTone?: 'info' | 'success';
  error: string | null;
  hasPinConfigured: boolean;
  onLogin: (input: DesktopSetupState & { password: string; pin: string }) => Promise<void>;
  onUnlock: (pin: string) => Promise<void>;
  onDownloadSetup: (setup: DesktopSetupState) => Promise<void>;
  onQuickSetup: (input: { token: string; pin: string; apiBaseUrl: string; deviceId: string; operatorName: string }) => Promise<void>;
  onExit: () => Promise<void>;
  onSwitchToLogin: () => void;
  onSwitchToPin: () => void;
};

export function DesktopStartupScreen({
  state,
  stage,
  busy,
  message,
  messageTone = 'info',
  error,
  hasPinConfigured,
  onLogin,
  onUnlock,
  onDownloadSetup,
  onQuickSetup,
  onExit,
  onSwitchToLogin,
  onSwitchToPin
}: Props): JSX.Element {
  const [form, setForm] = useState<DesktopSetupState>(prepareStartupSetup(state.setup, stage));
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [showQrModal, setShowQrModal] = useState(false);
  const [branchOptions, setBranchOptions] = useState<DesktopOption[]>([]);
  const [locationOptions, setLocationOptions] = useState<DesktopOption[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [optionMessage, setOptionMessage] = useState<string | null>(null);

  useEffect(() => {
    setForm(prepareStartupSetup(state.setup, stage));
  }, [state.setup, stage]);

  useEffect(() => {
    void playDesktopStartupCueOnce();
  }, []);

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
      return 'Unlock';
    }
    if (stage === 'SETUP') {
      return 'Choose Branch';
    }
    return 'Sign In';
  }, [stage]);

  const stageHint = useMemo(() => {
    if (stage === 'UNLOCK') {
      return 'Enter your PIN to continue.';
    }
    if (stage === 'SETUP') {
      return 'Choose branch and location, then continue.';
    }
    return 'Use password or QR quick setup.';
  }, [stage]);

  const branchLabel = branchOptions.find((option) => option.id === form.branchId)?.label ?? form.branchLabel;
  const locationLabel = locationOptions.find((option) => option.id === form.locationId)?.label ?? form.locationLabel;
  const canSubmitLogin =
    !busy &&
    form.apiBaseUrl.trim().length > 0 &&
    form.authEmail.trim().length > 0 &&
    password.trim().length > 0 &&
    form.deviceId.trim().length > 0;

  const handleLoginSubmit = (): void => {
    if (!canSubmitLogin) {
      return;
    }
    void onLogin({ ...form, password, pin: '' });
  };

  const handleLoginKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    handleLoginSubmit();
  };

  return (
    <>
      <div className="desktop-startup-shell">
        <div className="startup-ambient-orb startup-ambient-orb-a" aria-hidden="true" />
        <div className="startup-ambient-orb startup-ambient-orb-b" aria-hidden="true" />
        <section className="desktop-startup-card startup-enter-card">
          <div className="startup-brand-block startup-enter-brand">
            <BrandLogo title="VPOS Desktop" subtitle="Branch workstation setup and cashier access" compact />
          </div>

          <div className="startup-head startup-enter-copy">
            <div>
              <h2>{stageTitle}</h2>
              <p>{stageHint}</p>
            </div>
          </div>

          {stage === 'LOGIN' ? (
            <div className="startup-auth-stack">
              <div className="startup-mobile-card">
                <input
                  value={form.authEmail}
                  onChange={(event) => setForm((prev) => updateLoginEmail(prev, event.target.value))}
                  onKeyDown={handleLoginKeyDown}
                  placeholder="Email"
                  autoComplete="off"
                  disabled={busy}
                />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={handleLoginKeyDown}
                  placeholder="Password"
                  autoComplete="off"
                  disabled={busy}
                />
                <div className="startup-helper-copy">Your tenant is detected automatically from your cashier account.</div>
                <div className="startup-helper-copy">PIN is only used to unlock a saved session after sign-in.</div>
              </div>

              <div className="desktop-settings-actions startup-auth-actions">
                <button
                  className="primary-btn"
                  type="button"
                  onClick={handleLoginSubmit}
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
            </div>
          ) : null}

          {stage === 'UNLOCK' ? (
            <div className="startup-auth-stack">
              <div className="unlock-card">
                <strong>{state.auth.userFullName || state.auth.userEmail || 'Saved cashier session'}</strong>
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
                <span>Choose branch and location.</span>
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
                  Downloads data for {branchLabel || 'the selected branch'}.
                </div>
              </div>

              <div className="desktop-settings-actions startup-auth-actions">
                <button className="primary-btn" type="button" onClick={() => void onDownloadSetup({ ...form, branchLabel, locationLabel })} disabled={busy}>
                  {busy ? 'Downloading Branch Data...' : 'Download And Continue'}
                </button>
              </div>
            </div>
          ) : null}

          <div className={`message-banner ${error ? 'startup-error-banner' : messageTone === 'success' ? 'startup-success-banner' : ''}`}>
            {error || optionMessage || message}
          </div>
          <div className="desktop-settings-actions startup-auth-actions">
            <button className="secondary-btn" type="button" onClick={() => void onExit()}>
              Exit Application
            </button>
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
