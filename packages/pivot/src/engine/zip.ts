/**
 * Minimal, dependency-free ZIP writer (store method) — just enough of the
 * PKZIP/APPNOTE container to assemble a valid `.xlsx` (Office Open XML) package.
 *
 * Entries are written uncompressed (compression method 0) with a correct
 * CRC-32, packed as local file headers + a central directory + an
 * end-of-central-directory record. Storing uncompressed keeps this tiny while
 * still producing an archive Excel / LibreOffice accept (compression is
 * optional in the format). Paths are stored UTF-8 with the UTF-8 flag set.
 *
 * (Ported from the proven `@jects/spreadsheet` / `@jects/gantt` zip writer so
 * `@jects/pivot` stays dependency-free.)
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

/* ── UTF-8 ──────────────────────────────────────────────────────────────── */

const ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined;

/** Encode a string to UTF-8 bytes. */
export function utf8(str: string): Uint8Array {
  if (ENCODER) return ENCODER.encode(str);
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code >= 0xd800 && code <= 0xdbff) {
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
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
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

const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1980-01-01
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

    const local: number[] = [];
    pushU32(local, 0x04034b50);
    pushU16(local, 20);
    pushU16(local, FLAG_UTF8);
    pushU16(local, 0); // store
    pushU16(local, DOS_TIME);
    pushU16(local, DOS_DATE);
    pushU32(local, crc);
    pushU32(local, size);
    pushU32(local, size);
    pushU16(local, nameBytes.length);
    pushU16(local, 0);
    for (const b of nameBytes) local.push(b);
    for (let i = 0; i < data.length; i++) local.push(data[i]!);
    localChunks.push(local);

    const central: number[] = [];
    pushU32(central, 0x02014b50);
    pushU16(central, 20);
    pushU16(central, 20);
    pushU16(central, FLAG_UTF8);
    pushU16(central, 0);
    pushU16(central, DOS_TIME);
    pushU16(central, DOS_DATE);
    pushU32(central, crc);
    pushU32(central, size);
    pushU32(central, size);
    pushU16(central, nameBytes.length);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU32(central, 0);
    pushU32(central, offset);
    for (const b of nameBytes) central.push(b);
    centralChunks.push(central);

    offset += local.length;
  }

  const centralSize = centralChunks.reduce((n, c) => n + c.length, 0);
  const centralOffset = offset;

  const end: number[] = [];
  pushU32(end, 0x06054b50);
  pushU16(end, 0);
  pushU16(end, 0);
  pushU16(end, entries.length);
  pushU16(end, entries.length);
  pushU32(end, centralSize);
  pushU32(end, centralOffset);
  pushU16(end, 0);

  const totalSize = offset + centralSize + end.length;
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
