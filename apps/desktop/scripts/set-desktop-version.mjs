import fs from 'node:fs/promises';
import path from 'node:path';

const desktopRoot = path.resolve(import.meta.dirname, '..');
const packagePath = path.join(desktopRoot, 'package.json');
const tauriPath = path.join(desktopRoot, 'src-tauri', 'tauri.conf.json');
const cargoPath = path.join(desktopRoot, 'src-tauri', 'Cargo.toml');

function normalizeVersion(value) {
  const version = String(value ?? '').trim().replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid semantic version: ${value ?? '(missing)'}`);
  }
  return version;
}

async function readVersions() {
  const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  const tauriJson = JSON.parse(await fs.readFile(tauriPath, 'utf8'));
  const cargoText = await fs.readFile(cargoPath, 'utf8');
  const cargoVersion = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  return {
    packageVersion: packageJson.version,
    tauriVersion: tauriJson.package?.version,
    cargoVersion,
    packageJson,
    tauriJson,
    cargoText
  };
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const requested = args.find((value) => !value.startsWith('--'));
const current = await readVersions();

if (checkOnly) {
  const versions = [current.packageVersion, current.tauriVersion, current.cargoVersion];
  if (versions.some((value) => !value) || new Set(versions).size !== 1) {
    throw new Error(`Desktop version mismatch: package=${current.packageVersion}, tauri=${current.tauriVersion}, cargo=${current.cargoVersion}`);
  }
  normalizeVersion(versions[0]);
  console.log(`Desktop version sources match: ${versions[0]}`);
  process.exit(0);
}

const version = normalizeVersion(requested);
current.packageJson.version = version;
current.tauriJson.package.version = version;
const nextCargo = current.cargoText.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
if (nextCargo === current.cargoText && current.cargoVersion !== version) {
  throw new Error('Unable to update the Cargo package version.');
}

await fs.writeFile(packagePath, `${JSON.stringify(current.packageJson, null, 2)}\n`, 'utf8');
await fs.writeFile(tauriPath, `${JSON.stringify(current.tauriJson, null, 2)}\n`, 'utf8');
await fs.writeFile(cargoPath, nextCargo, 'utf8');
console.log(`Updated all VPOS Desktop version sources to ${version}.`);
