// Local QR renderer using vendored MIT QRCode implementation.
// This avoids external QR APIs so enrollment tokens never leave the platform.
declare const require: (moduleName: string) => any;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require('./qrcode-vendor/QRCode/index.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRErrorCorrectLevel = require('./qrcode-vendor/QRCode/QRErrorCorrectLevel.js');

export function buildQrSvgDataUrl(content: string, options?: { scale?: number; margin?: number }): string {
  const value = content.trim();
  if (!value) {
    return '';
  }

  const scale = Math.max(2, Math.min(16, Number(options?.scale ?? 6)));
  const margin = Math.max(0, Math.min(8, Number(options?.margin ?? 2)));

  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(value);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const size = (moduleCount + margin * 2) * scale;
  const paths: string[] = [];

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.isDark(row, col)) {
        continue;
      }
      const x = (col + margin) * scale;
      const y = (row + margin) * scale;
      paths.push(`M${x} ${y}h${scale}v${scale}h-${scale}Z`);
    }
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path d="${paths.join(' ')}" fill="#000000"/></svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
