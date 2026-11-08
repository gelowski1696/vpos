import fs from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(webRoot, relativePath), 'utf8');
}

function collectPages(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectPages(entryPath);
    }

    return entry.name === 'page.tsx' ? [entryPath] : [];
  });
}

describe('admin UI consistency', () => {
  it('places every admin route inside the shared page styling boundary', () => {
    const motionSource = read('src/components/admin-motion.tsx');

    expect(motionSource).toContain('data-admin-page');
    expect(motionSource).toContain('admin-route-page');
  });

  it('uses the shared animated and accessible dialog backdrop in custom routes', () => {
    const adminRoot = path.join(webRoot, 'src/app/(admin)');
    const legacyOverlays = collectPages(adminRoot).flatMap((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return /<div[\s\S]{0,180}?className="fixed inset-0[^\"]*bg-slate/g.test(source)
        ? [path.relative(webRoot, filePath)]
        : [];
    });

    expect(legacyOverlays).toEqual([]);

    const motionSource = read('src/components/admin-motion.tsx');
    expect(motionSource).toContain("querySelector<HTMLElement>('[role=\"dialog\"], [role=\"alertdialog\"]')");
    expect(motionSource).toContain("event.key === 'Escape'");
    expect(motionSource).toContain("event.key !== 'Tab'");

    expect(read('src/components/admin-shell.tsx')).toContain('<AdminModalMotion');
    expect(read('src/components/tenant-operational-reset-dialog.tsx')).toContain('<AdminModalMotion');
    expect(read('src/components/master-data-import-wizard.tsx')).toContain('onClose={close}');
  });

  it('keeps authentication pages on the same reconstructed visual system', () => {
    expect(read('src/app/(auth)/login/page.tsx')).toContain('<AuthWorkspace');
    expect(read('src/app/(auth)/change-password/page.tsx')).toContain('<AuthWorkspace');
    expect(read('src/app/not-found.tsx')).toContain('data-public-error');
  });
});
