import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const desktopRoot = join(__dirname, '..');

describe('desktop update release tooling', () => {
  it('keeps all desktop version sources aligned', () => {
    expect(() => execFileSync(process.execPath, [
      join(desktopRoot, 'scripts', 'set-desktop-version.mjs'),
      '--check'
    ], { cwd: desktopRoot, stdio: 'pipe' })).not.toThrow();
  });

  it('requires HTTPS, one artifact, a signature, and a checksum', () => {
    const source = readFileSync(join(desktopRoot, 'scripts', 'create-update-manifest.mjs'), 'utf8');
    expect(source).toContain("baseUrl.startsWith('https://')");
    expect(source).toContain('zipArtifacts.length > 1');
    expect(source).toContain('Updater signature is empty');
    expect(source).toContain("createHash('sha256')");
    expect(source).toContain('release-metadata.json');
  });
});
