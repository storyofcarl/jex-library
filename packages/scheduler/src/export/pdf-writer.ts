/**
 * Minimal, dependency-free PDF 1.4 writer (image-per-page).
 *
 * The scheduler PDF export rasterizes each page to a canvas, then embeds the
 * raster as an XObject image in a PDF page sized to the chosen paper. This
 * writer assembles a valid PDF document: catalog → pages → per-page `/Page`
 * with a `/XObject` image + a tiny content stream that draws the image to fill
 * the printable area (inside margins).
 *
 * Image encoding is `/FlateDecode` with **stored (uncompressed) zlib blocks** —
 * a valid deflate stream that needs no zlib library, keeping the package
 * zero-runtime-dependency (D5/D8) while remaining a real, spec-conformant PDF
 * any reader opens. Colour space is `/DeviceRGB`, 8 bits per channel.
 *
 * Coordinates: PDF's origin is bottom-left, y-up. We flip the image vertically
 * by placing it with a positive height transform from the bottom margin.
 */

/** One rasterized page: RGB pixel bytes (row-major, 3 bytes/px) + dimensions. */
export interface PdfImagePage {
  /** Pixel width. */
  width: number;
  /** Pixel height. */
  height: number;
  /** RGB bytes, length = width*height*3. */
  rgb: Uint8Array;
}

export interface PdfDocOptions {
  /** Paper width in PDF points (1pt = 1/72"). */
  pageWidth: number;
  /** Paper height in PDF points. */
  pageHeight: number;
  /** Margin in points applied on all sides. */
  margin: number;
  /** Document title (Info dict). */
  title?: string;
}

/* zlib "stored" wrapper: 0x78 0x01 header, stored deflate blocks, Adler-32. */
function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: number[] = [0x78, 0x01];
  const MAX = 0xffff;
  let offset = 0;
  while (offset < data.length || data.length === 0) {
    const len = Math.min(MAX, data.length - offset);
    const final = offset + len >= data.length ? 1 : 0;
    blocks.push(final); // BFINAL in bit0, BTYPE=00
    blocks.push(len & 0xff, (len >> 8) & 0xff);
    const nlen = (~len) & 0xffff;
    blocks.push(nlen & 0xff, (nlen >> 8) & 0xff);
    for (let i = 0; i < len; i++) blocks.push(data[offset + i]!);
    offset += len;
    if (len === 0) break;
  }
  // Adler-32 of the uncompressed data.
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  blocks.push((b >> 8) & 0xff, b & 0xff, (a >> 8) & 0xff, a & 0xff);
  return Uint8Array.from(blocks);
}

/** Latin1 string → bytes (PDF syntax is Latin1). */
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Escape a PDF text string for the Info dict. */
function pdfString(s: string): string {
  return '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
}

/**
 * Build a complete PDF document from rasterized pages. Returns the raw bytes
 * (the caller wraps them in a Blob / writes them out).
 */
export function buildPdf(pages: PdfImagePage[], opts: PdfDocOptions): Uint8Array {
  const objects: Uint8Array[] = []; // body bytes per object (incl. "N 0 obj"/"endobj")
  const ids: number[] = []; // 1-based object numbers in creation order

  let nextId = 1;
  const alloc = (): number => nextId++;

  // Reserve catalog + pages-tree ids first so /Kids can reference page ids.
  const catalogId = alloc();
  const pagesId = alloc();

  const pageObjIds: number[] = [];
  const pageObjects: { id: number; bytes: Uint8Array }[] = [];

  const printableW = opts.pageWidth - opts.margin * 2;
  const printableH = opts.pageHeight - opts.margin * 2;

  for (const img of pages) {
    const imgId = alloc();
    const contentId = alloc();
    const pageId = alloc();
    pageObjIds.push(pageId);

    // Fit image into the printable box preserving aspect ratio.
    const scale = Math.min(
      printableW / Math.max(1, img.width),
      printableH / Math.max(1, img.height),
    );
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const x = opts.margin;
    const y = opts.pageHeight - opts.margin - drawH;

    const stream = zlibStore(img.rgb);
    const imgHeader =
      `${imgId} 0 obj\n` +
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${stream.length} >>\n` +
      `stream\n`;
    const imgBytes = concat([latin1(imgHeader), stream, latin1('\nendstream\nendobj\n')]);
    pageObjects.push({ id: imgId, bytes: imgBytes });

    // Content stream: place + scale the image XObject.
    const content =
      `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    const contentStream = latin1(content);
    const contentObj = concat([
      latin1(`${contentId} 0 obj\n<< /Length ${contentStream.length} >>\nstream\n`),
      contentStream,
      latin1('\nendstream\nendobj\n'),
    ]);
    pageObjects.push({ id: contentId, bytes: contentObj });

    const pageObj = latin1(
      `${pageId} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R ` +
        `/MediaBox [0 0 ${opts.pageWidth} ${opts.pageHeight}] ` +
        `/Resources << /XObject << /Im0 ${imgId} 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>\nendobj\n`,
    );
    pageObjects.push({ id: pageId, bytes: pageObj });
  }

  // Pages tree.
  const kids = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  const pagesObj = latin1(
    `${pagesId} 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageObjIds.length} >>\nendobj\n`,
  );

  // Catalog (+ optional Info).
  const infoId = opts.title ? alloc() : 0;
  const catalogObj = latin1(
    `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`,
  );

  // Assemble in object-number order for a clean xref.
  const byId = new Map<number, Uint8Array>();
  byId.set(catalogId, catalogObj);
  byId.set(pagesId, pagesObj);
  for (const o of pageObjects) byId.set(o.id, o.bytes);
  if (infoId) {
    byId.set(
      infoId,
      latin1(
        `${infoId} 0 obj\n<< /Title ${pdfString(opts.title!)} /Producer (Jects UI Scheduler) >>\nendobj\n`,
      ),
    );
  }

  const total = nextId - 1;
  const header = latin1('%PDF-1.4\n%\xff\xff\xff\xff\n');
  const chunks: Uint8Array[] = [header];
  const offsets: number[] = new Array(total + 1).fill(0);
  let pos = header.length;
  for (let id = 1; id <= total; id++) {
    const bytes = byId.get(id);
    if (!bytes) continue;
    offsets[id] = pos;
    chunks.push(bytes);
    pos += bytes.length;
    ids.push(id);
    objects.push(bytes);
  }

  // xref table.
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= total; id++) {
    xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  const startxref = pos;
  const trailer =
    `trailer\n<< /Size ${total + 1} /Root ${catalogId} 0 R` +
    (infoId ? ` /Info ${infoId} 0 R` : '') +
    ` >>\nstartxref\n${startxref}\n%%EOF\n`;
  chunks.push(latin1(xref), latin1(trailer));

  return concat(chunks);
}
