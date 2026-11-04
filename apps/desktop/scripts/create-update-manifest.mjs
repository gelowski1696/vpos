import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const desktopRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const packageJsonPath = path.join(desktopRoot, 'package.json');
const bundleRoot = path.join(desktopRoot, 'src-tauri', 'target', 'release', 'bundle');
const otaOutputRoot = path.join(desktopRoot, 'release', 'ota');

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current.startsWith('--')) {
      args.set(current.slice(2), next && !next.startsWith('--') ? next : 'true');
      if (next && !next.startsWith('--')) {
        index += 1;
      }
    }
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function listFilesRecursive(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursive(fullPath)));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function normaliseBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

const args = parseArgs(process.argv.slice(2));
const packageJson = await readJson(packageJsonPath);
const version = args.get('version') ?? packageJson.version;
const notes = args.get('notes') ?? `VPOS Desktop ${version} release.`;
const pubDate = args.get('pub-date') ?? new Date().toISOString();
const baseUrl = normaliseBaseUrl(args.get('base-url') ?? process.env.VPOS_UPDATE_BASE_URL ?? 'https://vmjamtech.com/desktop-updates');
if (!baseUrl.startsWith('https://')) {
  throw new Error('VPOS_UPDATE_BASE_URL must use HTTPS.');
}

const allBundleFiles = await listFilesRecursive(bundleRoot);
const zipArtifacts = allBundleFiles.filter((filePath) => {
  const name = path.basename(filePath);
  return name.includes(version) && name.endsWith('.msi.zip');
});

if (zipArtifacts.length > 1) {
  throw new Error(`Multiple updater ZIP artifacts were found for version ${version}. Clean the Tauri bundle directory and rebuild.`);
}
const zipArtifact = zipArtifacts[0];

if (!zipArtifact) {
  throw new Error(`No updater ZIP artifact was found for version ${version}. Run 'pnpm --filter @vpos/desktop tauri:build:ota' first.`);
}

const sigArtifact = `${zipArtifact}.sig`;
try {
  await fs.access(sigArtifact);
} catch {
  throw new Error(`Updater signature file was not found next to ${path.basename(zipArtifact)}.`);
}

const signature = (await fs.readFile(sigArtifact, 'utf8')).trim();
if (!signature) {
  throw new Error(`Updater signature is empty for ${path.basename(zipArtifact)}.`);
}
const versionDir = path.join(otaOutputRoot, version);
await fs.mkdir(versionDir, { recursive: true });

const zipFileName = path.basename(zipArtifact);
const sigFileName = path.basename(sigArtifact);
await fs.copyFile(zipArtifact, path.join(versionDir, zipFileName));
await fs.copyFile(sigArtifact, path.join(versionDir, sigFileName));
const zipBytes = await fs.readFile(zipArtifact);
const checksum = crypto.createHash('sha256').update(zipBytes).digest('hex');
await fs.writeFile(path.join(versionDir, 'SHA256SUMS.txt'), `${checksum}  ${zipFileName}\n`, 'utf8');
let commitSha = 'unknown';
try {
  commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
} catch {
  // Release metadata remains useful outside a Git checkout.
}

const manifest = {
  version,
  notes,
  pub_date: pubDate,
  platforms: {
    'windows-x86_64': {
      signature,
      url: `${baseUrl}/${version}/${encodeURIComponent(zipFileName)}`
    }
  }
};

await fs.writeFile(path.join(otaOutputRoot, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(versionDir, 'release-metadata.json'), `${JSON.stringify({
  version,
  notes,
  pubDate,
  commitSha,
  sha256: checksum,
  artifact: zipFileName
}, null, 2)}\n`, 'utf8');

console.log(`Created OTA manifest for ${version}`);
console.log(`Manifest: ${path.relative(repoRoot, path.join(otaOutputRoot, 'latest.json'))}`);
console.log(`Artifact: ${path.relative(repoRoot, path.join(versionDir, zipFileName))}`);
console.log(`Signature: ${path.relative(repoRoot, path.join(versionDir, sigFileName))}`);
console.log(`SHA-256: ${checksum}`);
