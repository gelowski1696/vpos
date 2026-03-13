import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const mobileRoot = resolve(__dirname, '..');
const distApk = join(mobileRoot, 'dist', 'release', 'vpos-release.apk');
const gradleReleaseApk = join(
  mobileRoot,
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk',
);

const args = process.argv.slice(2);
const withBuild = args.includes('--build');
const serialArg = args.find((arg) => arg.startsWith('--serial='));
const serial = serialArg ? serialArg.slice('--serial='.length).trim() : '';

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    stdio: 'pipe',
    encoding: 'utf-8',
    ...options,
  });
}

function resolveApkPath() {
  if (existsSync(distApk)) {
    return distApk;
  }
  if (existsSync(gradleReleaseApk)) {
    return gradleReleaseApk;
  }
  return null;
}

if (withBuild) {
  console.log('[VPOS][APK] --build requested. Building release APK first...');
  const buildResult = run('node', [join(__dirname, 'build-release-apk.mjs')], {
    stdio: 'inherit',
    cwd: mobileRoot,
    env: process.env,
  });
  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
  }
}

const apkPath = resolveApkPath();
if (!apkPath) {
  console.error('[VPOS][APK] Release APK not found.');
  console.error(`[VPOS][APK] Expected one of:`);
  console.error(`  - ${distApk}`);
  console.error(`  - ${gradleReleaseApk}`);
  console.error('[VPOS][APK] Build first with: pnpm --filter @vpos/mobile apk:release');
  process.exit(1);
}

const adbCheck = run('adb', ['version']);
if (adbCheck.status !== 0) {
  console.error('[VPOS][APK] adb is not available in PATH.');
  console.error('[VPOS][APK] Install Android platform-tools and ensure adb is in PATH.');
  process.exit(1);
}

const devices = run('adb', ['devices']);
if (devices.status !== 0) {
  console.error('[VPOS][APK] Failed to query adb devices.');
  console.error(devices.stderr || devices.stdout);
  process.exit(1);
}

const lines = (devices.stdout || '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('List of devices attached'));

const onlineDevices = lines
  .map((line) => line.split(/\s+/))
  .filter((parts) => parts.length >= 2 && parts[1] === 'device')
  .map((parts) => parts[0]);

if (!serial && onlineDevices.length === 0) {
  console.error('[VPOS][APK] No online Android device detected.');
  console.error('[VPOS][APK] Connect device via USB/Wi-Fi and ensure USB debugging is enabled.');
  process.exit(1);
}

if (!serial && onlineDevices.length > 1) {
  console.error('[VPOS][APK] Multiple devices detected. Specify one with --serial=<deviceId>.');
  console.error(`[VPOS][APK] Devices: ${onlineDevices.join(', ')}`);
  process.exit(1);
}

if (serial && !onlineDevices.includes(serial)) {
  console.error(`[VPOS][APK] Device "${serial}" is not online.`);
  console.error(`[VPOS][APK] Online devices: ${onlineDevices.join(', ') || '(none)'}`);
  process.exit(1);
}

const resolvedSerial = serial || onlineDevices[0];
const installArgs = resolvedSerial
  ? ['-s', resolvedSerial, 'install', '-r', '-d', apkPath]
  : ['install', '-r', '-d', apkPath];

console.log(`[VPOS][APK] Installing ${apkPath}`);
if (resolvedSerial) {
  console.log(`[VPOS][APK] Target device: ${resolvedSerial}`);
}

const installResult = run('adb', installArgs, { stdio: 'inherit' });
if (installResult.status !== 0) {
  console.error('[VPOS][APK] APK install failed.');
  process.exit(installResult.status ?? 1);
}

console.log('[VPOS][APK] APK installed successfully.');
