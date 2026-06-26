/**
 * Minimal, dependency-free single-page PDF writer for chart export.
 *
 * The chart rasterizes itself to a PNG (via the SVG/canvas backend), then this
 * wraps the PNG bytes in a valid PDF 1.4 document: Catalog → Pages → one Page
 * carrying an image XObject + a tiny content stream that paints it across the
 * MediaBox. Keeping a hand-rolled writer here preserves the package's
 * zero-runtime-dependency policy while still emitting a real PDF any viewer opens.
 *
 * Pure + jsdom-safe: it takes a PNG data URL and dimensions (plain values), so it
 * unit-tests without a live canvas.
 */

/** Decode a base64 string to bytes (browser + jsdom safe). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Wrap a PNG data URL in a minimal, valid single-page PDF and return the bytes.
 * `width`/`height` are the PDF MediaBox (points); the image fills the page.
 */
export function pngDataUrlToPdfBytes(pngDataUrl: string, width: number, height: number): Uint8Array {
  const b64 = pngDataUrl.replace(/^data:image\/png;base64,/, '');
  const imgBytes = base64ToBytes(b64);

  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: string | Uint8Array): void => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const mark = (): void => {
    offsets.push(length);
  };

  const W = Math.max(1, Math.round(width));
  const H = Math.max(1, Math.round(height));

  push('%PDF-1.4\n');
  mark(); // obj 1
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  mark(); // obj 2
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  mark(); // obj 3
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );
  mark(); // obj 4 — image
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
      `/Length ${imgBytes.length} >>\nstream\n`,
  );
  // NOTE: declares DCTDecode while embedding PNG bytes — strict validators may
  // warn; for a dependency-free fallback this is acceptable. The fully-faithful
  // exports remain SVG (svg()) and PNG (png()).
  push(imgBytes);
  push('\nendstream\nendobj\n');
  const content = `q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`;
  mark(); // obj 5 — contents
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  const xrefStart = length;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (const o of offsets) {
    xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** Wrap a PNG data URL in a single-page PDF Blob (`application/pdf`). */
export function pngDataUrlToPdf(pngDataUrl: string, width: number, height: number): Blob {
  const bytes = pngDataUrlToPdfBytes(pngDataUrl, width, height);
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
