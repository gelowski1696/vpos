import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const desktopRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const docsRoot = path.join(repoRoot, 'docs');
const markdownPath = path.join(docsRoot, 'DESKTOP_UPDATE_USER_GUIDE.md');
const htmlPath = path.join(docsRoot, 'VPOS_DESKTOP_UPDATE_GUIDE.html');
const pdfPath = path.join(docsRoot, 'VPOS_DESKTOP_UPDATE_GUIDE.pdf');
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function inline(value) {
  return escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<figure><img src="$2" alt="$1"><figcaption>$1</figcaption></figure>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function markdownToHtml(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const output = [];
  let inCode = false;
  let codeLanguage = '';
  let codeLines = [];
  let listType = null;

  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = null;
  };

  for (const line of lines) {
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      if (!inCode) {
        closeList();
        inCode = true;
        codeLanguage = fence[1].trim();
        codeLines = [];
      } else {
        output.push(`<pre data-language="${escapeHtml(codeLanguage)}"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const pageClass = level === 2 && /^Part [A-C]:|^Troubleshooting/.test(heading[2]) ? ' class="chapter"' : '';
      output.push(`<h${level}${pageClass}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      closeList();
      output.push(`<figure><img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}"><figcaption>${escapeHtml(image[1])}</figcaption></figure>`);
      continue;
    }
    const unordered = line.match(/^\s*-\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      const nextType = ordered ? 'ol' : 'ul';
      if (listType !== nextType) {
        closeList();
        output.push(`<${nextType}>`);
        listType = nextType;
      }
      const content = (ordered ?? unordered)[1].replace(/^\[([ xX])\]\s*/, (_, checked) => checked.trim() ? '☑ ' : '☐ ');
      output.push(`<li>${inline(content)}</li>`);
      continue;
    }
    closeList();
    output.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return output.join('\n');
}

const markdown = await fs.readFile(markdownPath, 'utf8');
const body = markdownToHtml(markdown);
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>VPOS Desktop Update Guide</title>
<style>
@page { size: A4; margin: 15mm 16mm 17mm; }
:root { color: #10263a; font-family: "Segoe UI", Arial, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; font-size: 10.5pt; line-height: 1.52; color: #183148; }
h1 { margin: 0 0 8mm; padding: 13mm 12mm; color: white; font-size: 27pt; line-height: 1.08; background: #0d4770; border-radius: 7mm; }
h2 { margin: 9mm 0 4mm; padding-bottom: 2.5mm; color: #0d4770; font-size: 18pt; border-bottom: 1px solid #c9d9e7; }
h2.chapter { break-before: page; }
h3 { margin: 6mm 0 2mm; color: #123f61; font-size: 13.5pt; }
h4 { margin: 4mm 0 1.5mm; font-size: 11.5pt; }
p { margin: 0 0 3mm; }
ul, ol { margin: 0 0 4mm 5mm; padding-left: 5mm; }
li { margin: 0 0 1.4mm; }
strong { color: #102b42; }
code { padding: .3mm 1.2mm; color: #8a3d00; background: #fff4e8; border-radius: 1.2mm; font-family: Consolas, monospace; font-size: 9pt; }
pre { margin: 3mm 0 5mm; padding: 4mm; color: #eaf5ff; background: #102b42; border-radius: 3mm; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
pre code { padding: 0; color: inherit; background: none; font-size: 8.5pt; }
figure { margin: 5mm auto 7mm; text-align: center; break-inside: avoid; }
figure img { max-width: 92%; max-height: 205mm; border: 1px solid #cad9e6; border-radius: 5mm; box-shadow: 0 2mm 7mm rgba(20,55,82,.12); }
figcaption { margin-top: 2mm; color: #567087; font-size: 8.5pt; }
body > p:first-of-type { font-size: 12pt; color: #456178; }
</style></head><body>${body}</body></html>`;

await fs.writeFile(htmlPath, html, 'utf8');
const browser = await chromium.launch({ headless: true, executablePath: edgePath });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '15mm', right: '16mm', bottom: '17mm', left: '16mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#6c8294;text-align:center"><span>VPOS Desktop Update Guide</span> · <span class="pageNumber"></span>/<span class="totalPages"></span></div>'
  });
  console.log(`Created ${path.relative(repoRoot, pdfPath)}`);
} finally {
  await browser.close();
}
