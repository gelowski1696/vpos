import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const desktopRoot = join(__dirname, '..');

describe('desktop update release tooling', () => {
  it('keeps all desktop version sources aligned', () => {
    expect(() => execFileSync(process.execPath, [
      join(desktopRoot, 'scripts', 'set-desktop-version.mjs'),
      '--check'
    ], { cwd: desktopRoot, stdio: 'pipe' })).not.toThrow();
  });

  it('updates the application package entry in Cargo.lock', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'vpos-desktop-version-'));
    const fixtureScripts = join(fixtureRoot, 'scripts');
    const fixtureTauri = join(fixtureRoot, 'src-tauri');
    mkdirSync(fixtureScripts);
    mkdirSync(fixtureTauri);

    try {
      copyFileSync(join(desktopRoot, 'scripts', 'set-desktop-version.mjs'), join(fixtureScripts, 'set-desktop-version.mjs'));
      writeFileSync(join(fixtureRoot, 'package.json'), '{"version":"0.1.4"}\n');
      writeFileSync(join(fixtureTauri, 'tauri.conf.json'), '{"package":{"version":"0.1.4"}}\n');
      writeFileSync(join(fixtureTauri, 'Cargo.toml'), '[package]\nname = "vpos_desktop"\nversion = "0.1.4"\n');
      writeFileSync(
        join(fixtureTauri, 'Cargo.lock'),
        '[[package]]\nname = "dependency"\nversion = "0.1.4"\n\n[[package]]\nname = "vpos_desktop"\nversion = "0.1.4"\n'
      );

      execFileSync(process.execPath, [join(fixtureScripts, 'set-desktop-version.mjs'), '0.1.5'], {
        cwd: fixtureRoot,
        stdio: 'pipe'
      });

      const cargoLock = readFileSync(join(fixtureTauri, 'Cargo.lock'), 'utf8');
      expect(cargoLock).toContain('name = "dependency"\nversion = "0.1.4"');
      expect(cargoLock).toContain('name = "vpos_desktop"\nversion = "0.1.5"');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('requires HTTPS, one artifact, a signature, and a checksum', () => {
    const source = readFileSync(join(desktopRoot, 'scripts', 'create-update-manifest.mjs'), 'utf8');
    expect(source).toContain("baseUrl.startsWith('https://')");
    expect(source).toContain('zipArtifacts.length > 1');
    expect(source).toContain('Updater signature is empty');
    expect(source).toContain("createHash('sha256')");
    expect(source).toContain('release-metadata.json');
  });

  it('invokes the PowerShell release script without forwarding a pnpm separator', () => {
    const source = readFileSync(join(desktopRoot, '..', '..', 'scripts', 'publish-desktop-update.ps1'), 'utf8');
    expect(source).not.toContain("'desktop:release', '--'");
    expect(source).toContain('release-desktop-update.ps1');
    expect(source).toContain("'-File'");
  });
});
