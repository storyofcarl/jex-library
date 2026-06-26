/**
 * `@jects/gantt` — minimal, dependency-free ZIP writer.
 *
 * Just enough of the ZIP (PKZIP / APPNOTE) container to assemble an `.xlsx`
 * (Office Open XML) package: a flat list of `{ path, bytes }` entries written
 * with the **store** method (compression method 0 — no DEFLATE), each with a
 * correct CRC-32, packed as local file headers + a central directory + an
 * end-of-central-directory record.
 *
 * Storing uncompressed keeps this writer tiny and dependency-free while still
 * producing a fully valid archive Excel / LibreOffice / the OOXML spec accept
 * (compression is optional in the format). The produced bytes are returned as a
 * `Uint8Array` the XLSX writer wraps in a `Blob`.
 *
 * Encoding notes:
 *   - All paths are stored UTF-8; the UTF-8 language-encoding flag (bit 11) is
 *     set so non-ASCII member names decode correctly.
 *   - DOS date/time fields are written as a fixed epoch (1980-01-01) for
 *     deterministic, reproducible output (the XLSX content is the source of
 *     truth; archive timestamps are irrelevant to Excel).
 */

/** One file to place in the archive. */
export interface ZipEntry {
  /** Archive-relative path (forward slashes), e.g. `xl/worksheets/sheet1.xml`. */
  path: string;
  /** The file's raw bytes (already UTF-8 encoded for XML parts). */
  bytes: Uint8Array;
}

/* ── CRC-32 (IEEE 802.3, reflected) ─────────────────────────────────────── */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** Compute the CRC-32 checksum of a byte array. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ── UTF-8 helper ───────────────────────────────────────────────────────── */

const ENCODER =
  typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined;

/** Encode a string to UTF-8 bytes (TextEncoder, with a small manual fallback). */
export function utf8(str: string): Uint8Array {
  if (ENCODER) return ENCODER.encode(str);
  // Fallback for hosts without TextEncoder (very old / exotic): manual UTF-8.
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair.
      const hi = code;
      const lo = str.charCodeAt(++i);
      code = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      out.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/* ── little-endian writers ──────────────────────────────────────────────── */

function pushU16(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >>> 8) & 0xff);
}

function pushU32(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

// DOS time/date for a fixed, deterministic 1980-01-01 00:00:00.
const DOS_TIME = 0;
const DOS_DATE = 0x21; // year=0 (1980), month=1, day=1 → (0<<9)|(1<<5)|1.

// General-purpose bit flag: bit 11 = filenames/comments are UTF-8.
const FLAG_UTF8 = 0x0800;

/**
 * Assemble a list of entries into a valid `.zip` archive (store method, no
 * compression) and return the bytes. Deterministic for a given input.
 */
export function zipSync(entries: ZipEntry[]): Uint8Array {
  const localChunks: number[][] = [];
  const centralChunks: number[][] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = utf8(entry.path);
    const data = entry.bytes;
    const crc = crc32(data);
    const size = data.length;

    // ── Local file header ──
    const local: number[] = [];
    pushU32(local, 0x04034b50); // local file header signature
    pushU16(local, 20); // version needed to extract (2.0)
    pushU16(local, FLAG_UTF8); // general purpose bit flag
    pushU16(local, 0); // compression method = 0 (store)
    pushU16(local, DOS_TIME);
    pushU16(local, DOS_DATE);
    pushU32(local, crc);
    pushU32(local, size); // compressed size (== uncompressed for store)
    pushU32(local, size); // uncompressed size
    pushU16(local, nameBytes.length);
    pushU16(local, 0); // extra field length
    for (const b of nameBytes) local.push(b);
    for (let i = 0; i < data.length; i++) local.push(data[i]!);
    localChunks.push(local);

    // ── Central directory record ──
    const central: number[] = [];
    pushU32(central, 0x02014b50); // central file header signature
    pushU16(central, 20); // version made by
    pushU16(central, 20); // version needed
    pushU16(central, FLAG_UTF8);
    pushU16(central, 0); // method = store
    pushU16(central, DOS_TIME);
    pushU16(central, DOS_DATE);
    pushU32(central, crc);
    pushU32(central, size);
    pushU32(central, size);
    pushU16(central, nameBytes.length);
    pushU16(central, 0); // extra field length
    pushU16(central, 0); // file comment length
    pushU16(central, 0); // disk number start
    pushU16(central, 0); // internal file attributes
    pushU32(central, 0); // external file attributes
    pushU32(central, offset); // relative offset of local header
    for (const b of nameBytes) central.push(b);
    centralChunks.push(central);

    offset += local.length;
  }

  const centralSize = centralChunks.reduce((n, c) => n + c.length, 0);
  const centralOffset = offset;

  // ── End of central directory record ──
  const end: number[] = [];
  pushU32(end, 0x06054b50); // EOCD signature
  pushU16(end, 0); // number of this disk
  pushU16(end, 0); // disk where central directory starts
  pushU16(end, entries.length); // central dir records on this disk
  pushU16(end, entries.length); // total central dir records
  pushU32(end, centralSize);
  pushU32(end, centralOffset);
  pushU16(end, 0); // comment length

  // Concatenate everything into one buffer.
  const totalSize =
    offset + centralSize + end.length;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const chunk of localChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  for (const chunk of centralChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  out.set(end, pos);
  return out;
}
