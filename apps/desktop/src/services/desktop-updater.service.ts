import { getVersion } from '@tauri-apps/api/app';
import { checkUpdate, installUpdate, onUpdaterEvent, type UpdateManifest, type UpdateStatusResult } from '@tauri-apps/api/updater';
import { isDesktopTauriRuntime } from './tauri-runtime';

export type DesktopUpdateStatus =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'available'
  | 'current'
  | 'downloading'
  | 'installing'
  | 'restart_required'
  | 'failed';

export type DesktopUpdatePolicy = {
  platform: 'windows';
  arch: 'x86_64';
  enabled: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  minimumSupportedVersion: string | null;
  required: boolean;
  eligible: boolean;
  rolloutPercentage: number;
  releaseNotes: string | null;
  publishedAt: string | null;
  supportUrl: string | null;
};

export type DesktopUpdateCheckResult = {
  supported: boolean;
  status: DesktopUpdateStatus;
  currentVersion: string;
  available: boolean;
  required: boolean;
  manifest: UpdateManifest | null;
  policy: DesktopUpdatePolicy | null;
  policyError: string | null;
  errorCode: 'UNSUPPORTED' | 'OFFLINE' | 'MANIFEST' | 'UPDATER' | null;
  errorMessage: string | null;
  checkedAt: string;
};

export type DesktopUpdateSafety = {
  safe: boolean;
  blockers: string[];
  warnings: string[];
};

type CheckOptions = {
  apiBaseUrl?: string | null;
  deviceId?: string | null;
  fetchImpl?: typeof fetch;
};

const UPDATE_STATUS_STORAGE_KEY = 'vpos.desktop.update.status.v1';

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function updaterError(error: unknown): { code: DesktopUpdateCheckResult['errorCode']; message: string } {
  const message = error instanceof Error ? error.message : String(error || 'Desktop updater request failed.');
  const normalized = message.toLowerCase();
  if (normalized.includes('network') || normalized.includes('fetch') || normalized.includes('offline')) {
    return { code: 'OFFLINE', message: 'The update server is currently unreachable. Check the internet connection and try again.' };
  }
  if (normalized.includes('manifest') || normalized.includes('json') || normalized.includes('signature')) {
    return { code: 'MANIFEST', message: 'The published update information is invalid or could not be verified.' };
  }
  return { code: 'UPDATER', message };
}

export function assessDesktopUpdateSafety(input: {
  pendingOutboxCount: number;
  hasActiveShift: boolean;
  syncBusy: boolean;
  transactionBusy?: boolean;
}): DesktopUpdateSafety {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (input.transactionBusy) blockers.push('Finish the active transaction before installing.');
  if (input.syncBusy) blockers.push('Wait for the current synchronization to finish.');
  if (input.pendingOutboxCount > 0) blockers.push(`Sync ${input.pendingOutboxCount} pending record${input.pendingOutboxCount === 1 ? '' : 's'} before installing.`);
  if (input.hasActiveShift) warnings.push('A cashier shift is open. Close the shift before installing when possible.');
  return { safe: blockers.length === 0, blockers, warnings };
}

export class DesktopUpdaterService {
  async getCurrentVersion(): Promise<string> {
    if (!isDesktopTauriRuntime()) return 'web-preview';
    try {
      return await getVersion();
    } catch {
      return 'web-preview';
    }
  }

  getStoredStatus(): DesktopUpdateCheckResult | null {
    try {
      const raw = globalThis.localStorage?.getItem(UPDATE_STATUS_STORAGE_KEY);
      return raw ? JSON.parse(raw) as DesktopUpdateCheckResult : null;
    } catch {
      return null;
    }
  }

  async checkForUpdate(options: CheckOptions = {}): Promise<DesktopUpdateCheckResult> {
    const currentVersion = await this.getCurrentVersion();
    const checkedAt = new Date().toISOString();
    if (!isDesktopTauriRuntime() || currentVersion === 'web-preview') {
      return this.storeStatus({
        supported: false,
        status: 'unsupported',
        currentVersion,
        available: false,
        required: false,
        manifest: null,
        policy: null,
        policyError: null,
        errorCode: 'UNSUPPORTED',
        errorMessage: 'Desktop updates are available only from an installed VPOS Desktop build.',
        checkedAt
      });
    }

    const policyResult = await this.loadPolicy(currentVersion, options);
    try {
      const result = await checkUpdate();
      const allowedByPolicy = policyResult.policy
        ? policyResult.policy.enabled && policyResult.policy.eligible
        : true;
      const available = result.shouldUpdate && allowedByPolicy;
      return this.storeStatus({
        supported: true,
        status: available ? 'available' : 'current',
        currentVersion,
        available,
        required: Boolean(available && policyResult.policy?.required),
        manifest: available ? result.manifest ?? null : null,
        policy: policyResult.policy,
        policyError: policyResult.error,
        errorCode: null,
        errorMessage: null,
        checkedAt
      });
    } catch (error) {
      const detail = updaterError(error);
      return this.storeStatus({
        supported: true,
        status: 'failed',
        currentVersion,
        available: false,
        required: false,
        manifest: null,
        policy: policyResult.policy,
        policyError: policyResult.error,
        errorCode: detail.code,
        errorMessage: detail.message,
        checkedAt
      });
    }
  }

  async installAvailableUpdate(onStatus?: (event: UpdateStatusResult) => void): Promise<void> {
    if (!isDesktopTauriRuntime()) {
      throw new Error('OTA updates are only available in the installed desktop app.');
    }
    const unlisten = await onUpdaterEvent((event) => onStatus?.(event));
    try {
      await installUpdate();
    } finally {
      unlisten();
    }
  }

  private async loadPolicy(currentVersion: string, options: CheckOptions): Promise<{ policy: DesktopUpdatePolicy | null; error: string | null }> {
    const apiBaseUrl = options.apiBaseUrl?.trim();
    if (!apiBaseUrl) return { policy: null, error: null };
    const params = new URLSearchParams({ platform: 'windows', arch: 'x86_64', version: currentVersion });
    if (options.deviceId?.trim()) params.set('device_id', options.deviceId.trim());
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await (options.fetchImpl ?? fetch)(
        `${normalizeBaseUrl(apiBaseUrl)}/desktop-updates/policy?${params.toString()}`,
        { signal: controller.signal }
      );
      if (!response.ok) throw new Error(`Policy request failed (${response.status}).`);
      const policy = await response.json() as DesktopUpdatePolicy;
      if (policy.platform !== 'windows' || policy.arch !== 'x86_64') throw new Error('Update policy platform is invalid.');
      return { policy, error: null };
    } catch (error) {
      return { policy: null, error: error instanceof Error ? error.message : 'Update policy is unavailable.' };
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  private storeStatus(result: DesktopUpdateCheckResult): DesktopUpdateCheckResult {
    try {
      globalThis.localStorage?.setItem(UPDATE_STATUS_STORAGE_KEY, JSON.stringify(result));
    } catch {
      // Update checks still work when storage is unavailable.
    }
    return result;
  }
}

export const desktopUpdaterService = new DesktopUpdaterService();
