import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const desktopRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const htmlPath = path.join(repoRoot, 'docs', 'VPOS_CASHIER_SYSTEM_UPDATE_GUIDE.html');
const pdfPath = path.join(repoRoot, 'docs', 'VPOS_CASHIER_SYSTEM_UPDATE_GUIDE.pdf');
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const previewRequested = process.argv.includes('--preview');

const browser = await chromium.launch({ headless: true, executablePath: edgePath });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '13mm', right: '14mm', bottom: '16mm', left: '14mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#6c8294;text-align:center"><span>VPOS Cashier System Update Guide</span> &middot; <span class="pageNumber"></span>/<span class="totalPages"></span></div>'
  });
  if (previewRequested) {
    await page.emulateMedia({ media: 'print' });
    const guidePages = page.locator('.page');
    for (let index = 0; index < await guidePages.count(); index += 1) {
      await guidePages.nth(index).screenshot({
        path: path.join(process.env.TEMP ?? repoRoot, `vpos-cashier-update-guide-page-${index + 1}.png`)
      });
    }
  }
  console.log(`Created ${path.relative(repoRoot, pdfPath)}`);
} finally {
  await browser.close();
}
