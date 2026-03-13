import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const mobileRoot = resolve(__dirname, '..');
const androidDir = join(mobileRoot, 'android');
const releaseApk = join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const distDir = join(mobileRoot, 'dist', 'release');
const distApk = join(distDir, 'vpos-release.apk');
const withClean = process.argv.includes('--clean');
const withDebug = process.argv.includes('--debug');

if (!existsSync(androidDir)) {
  console.error('[VPOS][APK] Android native project not found at apps/mobile/android.');
  console.error('[VPOS][APK] Run `pnpm --filter @vpos/mobile android` once to generate native project, then retry.');
  process.exit(1);
}

const gradleTasks = withClean ? ['clean', 'assembleRelease'] : ['assembleRelease'];
const gradleArgs = [...gradleTasks, '--no-daemon', '--console=plain', ...(withDebug ? ['--stacktrace'] : [])];

console.log(`[VPOS][APK] Starting release build (${gradleArgs.join(' ')})...`);
console.log('[VPOS][APK] Note: first release bundle can take several minutes while Metro builds JS assets.');

const mergedEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'production',
  CI: process.env.CI || '1',
  EXPO_NO_INTERACTIVE: process.env.EXPO_NO_INTERACTIVE || '1',
  EXPO_NO_METRO_WORKSPACE_ROOT: process.env.EXPO_NO_METRO_WORKSPACE_ROOT || '1',
  EXPO_USE_METRO_WORKSPACE_ROOT: process.env.EXPO_USE_METRO_WORKSPACE_ROOT || '0',
  NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096'
};

const result =
  process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'gradlew.bat', ...gradleArgs], {
        cwd: androidDir,
        stdio: 'inherit',
        env: mergedEnv
      })
    : spawnSync('./gradlew', gradleArgs, {
        cwd: androidDir,
        stdio: 'inherit',
        env: mergedEnv
      });

if (result.status !== 0) {
  if (result.signal) {
    console.error(`[VPOS][APK] Build interrupted by signal: ${result.signal}.`);
    console.error('[VPOS][APK] If you pressed Ctrl+C, this non-zero exit is expected.');
  } else {
    console.error(`[VPOS][APK] Build failed with exit code ${result.status ?? 'unknown'}.`);
  }
  console.error('[VPOS][APK] Run this for detailed diagnostics:');
  console.error('[VPOS][APK]   pnpm --filter @vpos/mobile apk:release:debug');
  process.exit(result.status ?? 1);
}

if (!existsSync(releaseApk)) {
  console.error('[VPOS][APK] Build finished but app-release.apk was not found.');
  console.error(`[VPOS][APK] Expected path: ${releaseApk}`);
  process.exit(1);
}

mkdirSync(distDir, { recursive: true });
copyFileSync(releaseApk, distApk);

console.log('[VPOS][APK] Release APK built successfully.');
console.log(`[VPOS][APK] Source: ${releaseApk}`);
console.log(`[VPOS][APK] Copied: ${distApk}`);
