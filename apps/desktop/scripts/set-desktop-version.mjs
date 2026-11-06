import fs from 'node:fs/promises';
import path from 'node:path';

const desktopRoot = path.resolve(import.meta.dirname, '..');
const packagePath = path.join(desktopRoot, 'package.json');
const tauriPath = path.join(desktopRoot, 'src-tauri', 'tauri.conf.json');
const cargoPath = path.join(desktopRoot, 'src-tauri', 'Cargo.toml');
const cargoLockPath = path.join(desktopRoot, 'src-tauri', 'Cargo.lock');

function normalizeVersion(value) {
  const version = String(value ?? '').trim().replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid semantic version: ${value ?? '(missing)'}`);
  }
  return version;
}

function findCargoLockPackage(cargoLockText) {
  const blocks = cargoLockText.split(/(?=\[\[package\]\])/);
  const index = blocks.findIndex((block) => /^name\s*=\s*"vpos_desktop"\s*$/m.test(block));
  if (index < 0) {
    throw new Error('Unable to find the vpos_desktop package in Cargo.lock.');
  }
  const version = blocks[index].match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1] ?? null;
  return { blocks, index, version };
}

function updateCargoLockVersion(cargoLockText, version) {
  const cargoLockPackage = findCargoLockPackage(cargoLockText);
  const nextBlock = cargoLockPackage.blocks[cargoLockPackage.index].replace(
    /^version\s*=\s*"[^"]+"/m,
    `version = "${version}"`
  );
  if (nextBlock === cargoLockPackage.blocks[cargoLockPackage.index] && cargoLockPackage.version !== version) {
    throw new Error('Unable to update the Cargo.lock package version.');
  }
  cargoLockPackage.blocks[cargoLockPackage.index] = nextBlock;
  return cargoLockPackage.blocks.join('');
}

async function readVersions() {
  const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  const tauriJson = JSON.parse(await fs.readFile(tauriPath, 'utf8'));
  const cargoText = await fs.readFile(cargoPath, 'utf8');
  const cargoLockText = await fs.readFile(cargoLockPath, 'utf8');
  const cargoVersion = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  const cargoLockVersion = findCargoLockPackage(cargoLockText).version;
  return {
    packageVersion: packageJson.version,
    tauriVersion: tauriJson.package?.version,
    cargoVersion,
    cargoLockVersion,
    packageJson,
    tauriJson,
    cargoText,
    cargoLockText
  };
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const requested = args.find((value) => !value.startsWith('--'));
const current = await readVersions();

if (checkOnly) {
  const versions = [current.packageVersion, current.tauriVersion, current.cargoVersion, current.cargoLockVersion];
  if (versions.some((value) => !value) || new Set(versions).size !== 1) {
    throw new Error(
      `Desktop version mismatch: package=${current.packageVersion}, tauri=${current.tauriVersion}, cargo=${current.cargoVersion}, cargoLock=${current.cargoLockVersion}`
    );
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
const nextCargoLock = updateCargoLockVersion(current.cargoLockText, version);

await fs.writeFile(packagePath, `${JSON.stringify(current.packageJson, null, 2)}\n`, 'utf8');
await fs.writeFile(tauriPath, `${JSON.stringify(current.tauriJson, null, 2)}\n`, 'utf8');
await fs.writeFile(cargoPath, nextCargo, 'utf8');
await fs.writeFile(cargoLockPath, nextCargoLock, 'utf8');
console.log(`Updated all VPOS Desktop version sources to ${version}.`);
