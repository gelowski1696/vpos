import { Injectable } from '@nestjs/common';

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

@Injectable()
export class DesktopUpdatesService {
  getPolicy(input: {
    platform?: string;
    arch?: string;
    version?: string;
    deviceId?: string;
  }): DesktopUpdatePolicy {
    const latestVersion = this.readVersion('DESKTOP_WINDOWS_LATEST_VERSION');
    const minimumSupportedVersion = this.readVersion('DESKTOP_WINDOWS_MIN_SUPPORTED_VERSION');
    const currentVersion = this.normalizeVersion(input.version);
    const rolloutPercentage = this.readPercentage('DESKTOP_WINDOWS_ROLLOUT_PERCENTAGE', 100);
    const configuredRequired = this.readBoolean('DESKTOP_WINDOWS_REQUIRED');
    const belowMinimum = Boolean(
      currentVersion &&
      minimumSupportedVersion &&
      this.compareVersions(currentVersion, minimumSupportedVersion) < 0
    );
    const requestedPlatform = input.platform?.trim().toLowerCase();
    const requestedArch = input.arch?.trim().toLowerCase();
    const supportedTarget = (!requestedPlatform || requestedPlatform === 'windows') &&
      (!requestedArch || requestedArch === 'x86_64' || requestedArch === 'x64');
    const enabled = supportedTarget && this.readBoolean('DESKTOP_WINDOWS_UPDATES_ENABLED', Boolean(latestVersion));
    const eligible = enabled && this.isDeviceEligible(input.deviceId, rolloutPercentage, belowMinimum || configuredRequired);

    return {
      platform: 'windows',
      arch: 'x86_64',
      enabled,
      currentVersion,
      latestVersion,
      minimumSupportedVersion,
      required: enabled && (configuredRequired || belowMinimum),
      eligible,
      rolloutPercentage,
      releaseNotes: this.readEnv('DESKTOP_WINDOWS_RELEASE_NOTES'),
      publishedAt: this.readIsoDate('DESKTOP_WINDOWS_PUBLISHED_AT'),
      supportUrl: this.readHttpsUrl('DESKTOP_WINDOWS_SUPPORT_URL')
    };
  }

  private isDeviceEligible(deviceId: string | undefined, percentage: number, force: boolean): boolean {
    if (force || percentage >= 100) return true;
    if (percentage <= 0 || !deviceId?.trim()) return false;
    let hash = 2166136261;
    for (const character of deviceId.trim()) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 100 < percentage;
  }

  private compareVersions(left: string, right: string): number {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
      if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
    }
    return 0;
  }

  private normalizeVersion(value: string | undefined): string | null {
    const normalized = value?.trim().replace(/^v/i, '') ?? '';
    return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : null;
  }

  private readVersion(key: string): string | null {
    return this.normalizeVersion(this.readEnv(key) ?? undefined);
  }

  private readPercentage(key: string, fallback: number): number {
    const parsed = Number(this.readEnv(key) ?? fallback);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.round(parsed))) : fallback;
  }

  private readBoolean(key: string, fallback = false): boolean {
    const value = this.readEnv(key)?.toLowerCase();
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return fallback;
  }

  private readIsoDate(key: string): string | null {
    const value = this.readEnv(key);
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  private readHttpsUrl(key: string): string | null {
    const value = this.readEnv(key);
    if (!value) return null;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' ? parsed.toString() : null;
    } catch {
      return null;
    }
  }

  private readEnv(key: string): string | null {
    const value = process.env[key]?.trim();
    return value ? value : null;
  }
}
