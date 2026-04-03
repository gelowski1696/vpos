import { Injectable } from '@nestjs/common';

export type MobileUpdateManifest = {
  platform: 'android';
  enabled: boolean;
  latestVersion: string | null;
  minimumSupportedVersion: string | null;
  required: boolean;
  apkUrl: string | null;
  notes: string | null;
  publishedAt: string | null;
};

@Injectable()
export class MobileUpdatesService {
  getLatestAndroidManifest(): MobileUpdateManifest {
    const latestVersion = this.readEnv('MOBILE_ANDROID_LATEST_VERSION');
    const minimumSupportedVersion = this.readEnv('MOBILE_ANDROID_MIN_SUPPORTED_VERSION');
    const apkUrl = this.readEnv('MOBILE_ANDROID_APK_URL');
    const notes = this.readEnv('MOBILE_ANDROID_NOTES');
    const publishedAt = this.readEnv('MOBILE_ANDROID_PUBLISHED_AT');
    const requiredRaw = this.readEnv('MOBILE_ANDROID_REQUIRED');
    const required = requiredRaw === 'true' || requiredRaw === '1';
    const enabled = Boolean(latestVersion && apkUrl);

    return {
      platform: 'android',
      enabled,
      latestVersion,
      minimumSupportedVersion,
      required,
      apkUrl,
      notes,
      publishedAt
    };
  }

  private readEnv(key: string): string | null {
    const value = process.env[key];
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
}
