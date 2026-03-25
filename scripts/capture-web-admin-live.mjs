import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function argValue(flag, fallback = "") {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

function resolveChromeExecutable() {
  const explicit = argValue("--chrome", "").trim();
  if (explicit) {
    return explicit;
  }
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ];
  return candidates[0];
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function sanitize(value) {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

async function screenshot(page, outPath) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: outPath, fullPage: true });
}

async function apiLogin(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      device_id: "web-admin"
    })
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Login API failed (${response.status}): ${raw}`);
  }
  const parsed = JSON.parse(raw);
  if (!parsed?.access_token || !parsed?.refresh_token) {
    throw new Error("Login API succeeded but token payload is incomplete.");
  }
  return parsed;
}

async function clickIfVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    await locator.click({ timeout: 5000 }).catch(() => {});
    return true;
  }
  return false;
}

const baseUrl = (argValue("--base-url", "https://vmjamtech.com") || "").replace(/\/+$/, "");
const email = argValue("--email", "");
const password = argValue("--password", "");

if (!email || !password) {
  console.error("[VPOS][WEBCAP] Missing --email or --password");
  process.exit(1);
}

const outputRoot = path.join(repoRoot, "docs", "presentation", "live", "web-admin");
await ensureDir(outputRoot);

const routes = [
  { path: "/dashboard", label: "Dashboard" },
  { path: "/reports", label: "Reports" },
  { path: "/sales-list", label: "Sales List" },
  { path: "/customer-payments", label: "Customer Payments" },
  { path: "/customers", label: "Customers" },
  { path: "/products", label: "Products" },
  { path: "/product-categories", label: "Product Categories" },
  { path: "/product-brands", label: "Product Brands" },
  { path: "/cylinder-types", label: "Cylinder Types" },
  { path: "/inventory-opening", label: "Opening Stock" },
  { path: "/price-lists", label: "Price Lists" },
  { path: "/costing", label: "Costing Setup" },
  { path: "/transfer-list", label: "Transfer List" },
  { path: "/branches", label: "Branches" },
  { path: "/locations", label: "Locations" },
  { path: "/users", label: "Users" },
  { path: "/personnels", label: "Personnel" },
  { path: "/suppliers", label: "Suppliers" },
  { path: "/branding", label: "Branding" },
  { path: "/personnel-roles", label: "Personnel Roles" },
  { path: "/expenses", label: "Expense Categories" },
  { path: "/sync-reviews", label: "Sync Reviews" },
  { path: "/audit-logs", label: "Audit Logs" }
];

const functionCaptures = [
  {
    name: "global-search",
    route: "/dashboard",
    run: async (page, outDir) => {
      const searchInput = page.locator('[data-tour="global-search"] input').first();
      if ((await searchInput.isVisible().catch(() => false)) === false) {
        return null;
      }
      await searchInput.click();
      await searchInput.fill("sales");
      await page.waitForTimeout(900);
      const out = path.join(outDir, "function-global-search.png");
      await screenshot(page, out);
      await page.keyboard.press("Escape").catch(() => {});
      return out;
    }
  },
  {
    name: "sales-detail",
    route: "/sales-list",
    run: async (page, outDir) => {
      const opened = await clickIfVisible(page, [
        '[data-tour="sales-list-view"]',
        'button:has-text("View")'
      ]);
      if (!opened) {
        return null;
      }
      await page.waitForTimeout(900);
      const out = path.join(outDir, "function-sales-detail-modal.png");
      await screenshot(page, out);
      await page.keyboard.press("Escape").catch(() => {});
      return out;
    }
  },
  {
    name: "customers-transactions",
    route: "/customers",
    run: async (page, outDir) => {
      const opened = await clickIfVisible(page, ['button:has-text("Transactions")', 'button:has-text("View")']);
      if (!opened) {
        return null;
      }
      await page.waitForTimeout(900);
      const out = path.join(outDir, "function-customer-transactions-modal.png");
      await screenshot(page, out);
      await page.keyboard.press("Escape").catch(() => {});
      return out;
    }
  },
  {
    name: "products-view",
    route: "/products",
    run: async (page, outDir) => {
      const opened = await clickIfVisible(page, ['button:has-text("View")']);
      if (!opened) {
        return null;
      }
      await page.waitForTimeout(900);
      const out = path.join(outDir, "function-product-view.png");
      await screenshot(page, out);
      await page.keyboard.press("Escape").catch(() => {});
      return out;
    }
  },
  {
    name: "opening-stock-modal",
    route: "/inventory-opening",
    run: async (page, outDir) => {
      const opened = await clickIfVisible(page, ['button:has-text("Apply Opening Stock")']);
      if (!opened) {
        return null;
      }
      await page.waitForTimeout(900);
      const out = path.join(outDir, "function-opening-stock-modal.png");
      await screenshot(page, out);
      await page.keyboard.press("Escape").catch(() => {});
      return out;
    }
  }
];

const addModalSelectorsByRoute = {
  "/customers": ['[data-tour="customers-entity-add"]', 'button:has-text("Add New")', 'button:has-text("Create")'],
  "/products": ['[data-tour="products-entity-add"]', 'button:has-text("Add New")', 'button:has-text("Create")'],
  "/product-categories": ['[data-tour="product-categories-entity-add"]', 'button:has-text("Add New")', 'button:has-text("Create")'],
  "/product-brands": ['[data-tour="product-brands-entity-add"]', 'button:has-text("Add New")', 'button:has-text("Create")'],
  "/cylinder-types": ['[data-tour="cylinder-types-entity-add"]', 'button:has-text("Add New")', 'button:has-text("Create")'],
  "/branches": ['[data-tour="branches-entity-add"]', 'button:has-text("Add New")', 'button:has-text("Create")'],
  "/locations": ['[data-tour="locations-entity-add"]', 'button:has-text("Add New")', 'button:has-text("Create")'],
  "/users": ['[data-tour="users-entity-add"]', 'button:has-text("Add New")', 'button:has-text("Create")'],
  "/personnels": ['[data-tour="personnel-entity-add"]', 'button:has-text("Add New")', 'button:has-text("Create")'],
  "/suppliers": ['[data-tour="suppliers-entity-add"]', 'button:has-text("Add New")', 'button:has-text("Create")'],
  "/personnel-roles": ['[data-tour="personnel-roles-entity-add"]', 'button:has-text("Add New")', 'button:has-text("Create")'],
  "/expenses": ['[data-tour="expense-categories-entity-add"]', 'button:has-text("Add New")', 'button:has-text("Create")'],
  "/inventory-opening": ['button:has-text("Apply Opening Stock")', 'button:has-text("Apply Opening")', 'button:has-text("Apply")']
};

const chromeExecutable = resolveChromeExecutable();
const browser = await chromium.launch({
  headless: true,
  executablePath: chromeExecutable,
  args: ["--disable-gpu", "--no-sandbox"]
});

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 }
});
const page = await context.newPage();

const captured = [];
const skipped = [];

try {
  console.log("[VPOS][WEBCAP] Logging in via API...");
  const session = await apiLogin(baseUrl, email, password);
  await context.addInitScript(
    ({ accessToken, refreshToken, clientId }) => {
      localStorage.setItem("vpos_admin_access_token", accessToken);
      localStorage.setItem("vpos_admin_refresh_token", refreshToken);
      localStorage.setItem("vpos_admin_client_id", clientId);
    },
    {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      clientId: session.client_id ?? "DEMO"
    }
  );

  console.log("[VPOS][WEBCAP] Opening dashboard...");
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "networkidle", timeout: 45000 });

  // Disable walkthrough overlays so screenshots stay clean.
  await page.evaluate(() => {
    localStorage.setItem("vpos_web_admin_walkthrough_v1_done", "1");
    Object.keys(localStorage)
      .filter((key) => key.startsWith("vpos_web_admin_walkthrough_route_"))
      .forEach((key) => localStorage.setItem(key, "1"));
  });

  const loginSuccessPath = path.join(outputRoot, "00-login-success.png");
  await screenshot(page, loginSuccessPath);
  captured.push(loginSuccessPath);

  for (const [index, route] of routes.entries()) {
    const url = `${baseUrl}${route.path}`;
    console.log(`[VPOS][WEBCAP] Capturing ${route.label} -> ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(900);

    const out = path.join(outputRoot, `${String(index + 1).padStart(2, "0")}-${sanitize(route.label)}.png`);
    await screenshot(page, out);
    captured.push(out);

    for (const fn of functionCaptures.filter((entry) => entry.route === route.path)) {
      try {
        const fnOut = await fn.run(page, outputRoot);
        if (fnOut) {
          captured.push(fnOut);
        } else {
          skipped.push(`${fn.name} (no matching element)`);
        }
      } catch (error) {
        skipped.push(`${fn.name} (${error instanceof Error ? error.message : "failed"})`);
      }
    }

    const addSelectors = addModalSelectorsByRoute[route.path];
    if (addSelectors) {
      const opened = await clickIfVisible(page, addSelectors);
      if (opened) {
        await page.waitForTimeout(800);
        const fnOut = path.join(
          outputRoot,
          `function-${sanitize(route.label)}-create-modal.png`
        );
        await screenshot(page, fnOut);
        captured.push(fnOut);
        await page.keyboard.press("Escape").catch(() => {});
      } else {
        skipped.push(`create-modal ${route.path} (no matching element)`);
      }
    }
  }

  const html = `
<!doctype html>
<html><head><meta charset="utf-8" />
<title>VPOS Web Admin Live Captures</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#0b0b0b;color:#f4f4f4}
.wrap{padding:20px}
.card{page-break-after:always;border:1px solid rgba(243,198,79,.3);border-radius:12px;padding:14px;margin-bottom:16px;background:#151515}
.card img{width:100%;border-radius:8px}
.meta{font-size:12px;color:#f3c64f;margin-bottom:8px}
h1{margin:0 0 8px 0}
</style></head>
<body><div class="wrap"><h1>VPOS Web Admin - Live Captures</h1>
${captured
  .map((img) => {
    const rel = path.relative(path.join(repoRoot, "docs", "presentation"), img).replace(/\\/g, "/");
    return `<section class="card"><div class="meta">${rel}</div><img src="./${rel}" /></section>`;
  })
  .join("\n")}
</div></body></html>`;

  const presentationRoot = path.join(repoRoot, "docs", "presentation");
  const htmlPath = path.join(presentationRoot, "web-admin-live-captures-deck.html");
  await fs.writeFile(htmlPath, html, "utf8");

  const pdfPage = await context.newPage();
  await pdfPage.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "networkidle" });
  const pdfPath = path.join(outputRoot, "vpos-web-admin-live-captures.pdf");
  await pdfPage.pdf({ path: pdfPath, format: "A4", printBackground: true });
  await pdfPage.close();

  const reportPath = path.join(outputRoot, "capture-report.txt");
  const report = [
    `Base URL: ${baseUrl}`,
    `Captured files: ${captured.length}`,
    ...captured.map((file) => ` - ${path.basename(file)}`),
    "",
    `Skipped items: ${skipped.length}`,
    ...skipped.map((line) => ` - ${line}`)
  ].join("\n");
  await fs.writeFile(reportPath, report, "utf8");

  console.log(`[VPOS][WEBCAP] Done. Output: ${outputRoot}`);
  console.log(`[VPOS][WEBCAP] PDF: ${pdfPath}`);
} finally {
  await context.close();
  await browser.close();
}
