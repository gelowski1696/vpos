import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const desktopRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const outputRoot = path.join(repoRoot, 'docs', 'assets', 'desktop-update-guide');
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const appUrl = process.env.VPOS_DESKTOP_PREVIEW_URL ?? 'http://127.0.0.1:1420/';

function tokenWithCashierRole() {
  const payload = Buffer.from(JSON.stringify({ roles: ['cashier'], email: 'cashier@demo.local', full_name: 'Demo Cashier' })).toString('base64url');
  return `docs.${payload}.signature`;
}

function demoState(now) {
  return {
    version: 1,
    setupCompleted: true,
    setup: {
      operatorName: 'Demo Cashier', clientId: 'DEMO', authEmail: 'cashier@demo.local', deviceId: 'DESKTOP-DEMO-01',
      branchId: 'branch-1', branchLabel: 'Main Branch', locationId: 'location-1', locationLabel: 'Store Counter',
      apiBaseUrl: 'http://127.0.0.1:39999/api', printerMode: 'USB', printerName: 'Receipt Printer',
      printerHost: '', printerPort: '9100', posDefaultLpgFlow: 'NONE'
    },
    auth: {
      accessToken: tokenWithCashierRole(), refreshToken: 'docs-refresh', signedInAt: now,
      userEmail: 'cashier@demo.local', userFullName: 'Demo Cashier', pinHash: null, pinSalt: null
    },
    printerProfiles: [],
    walkthrough: { completedAt: now, dismissedAt: null },
    sync: { lastSyncedAt: now, lastPullToken: null, lastSyncStatus: 'success', lastSyncMessage: 'Branch data downloaded.' }
  };
}

function demoUpdate(now) {
  return {
    supported: true, status: 'available', currentVersion: '0.1.2', available: true, required: false,
    manifest: { version: '0.1.3', date: now, body: 'Inventory and stability improvements.' },
    policy: {
      platform: 'windows', arch: 'x86_64', enabled: true, currentVersion: '0.1.2', latestVersion: '0.1.3',
      minimumSupportedVersion: '0.1.1', required: false, eligible: true, rolloutPercentage: 100,
      releaseNotes: 'Inventory and stability improvements.', publishedAt: now, supportUrl: 'https://vmjamtech.com/support'
    },
    policyError: null, errorCode: null, errorMessage: null, checkedAt: now
  };
}

function pendingRows(now) {
  return [1, 2].map((index) => ({
    id: `docs-pending-${index}`, entity: 'sale', action: 'create', payload: {},
    idempotency_key: `docs-${index}`, created_at: now, updated_at: now,
    status: 'pending', retry_count: 0, last_error: null
  }));
}

async function capture(browser, fileName, pending) {
  const now = '2026-11-04T10:00:00.000Z';
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1.5 });
  await page.addInitScript(({ state, update, outbox }) => {
    localStorage.setItem('vpos-desktop-app-state', JSON.stringify(state));
    localStorage.setItem('vpos.desktop.update.status.v1', JSON.stringify(update));
    localStorage.setItem('vpos-desktop-outbox', JSON.stringify(outbox));
  }, { state: demoState(now), update: demoUpdate(now), outbox: pending ? pendingRows(now) : [] });
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await page.getByText('Settings', { exact: true }).first().click();
  await page.waitForTimeout(500);
  const card = page.getByText('Desktop OTA', { exact: true }).locator('xpath=../../..');
  await card.scrollIntoViewIfNeeded();
  await card.getByText('web-preview', { exact: true }).evaluate((node) => { node.textContent = '0.1.2'; });
  await card.screenshot({ path: path.join(outputRoot, fileName) });
  await page.close();
}

await fs.mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: edgePath });
try {
  await capture(browser, 'update-ready.png', false);
  await capture(browser, 'update-sync-required.png', true);
  console.log(`Captured update guide screenshots in ${path.relative(repoRoot, outputRoot)}`);
} finally {
  await browser.close();
}
