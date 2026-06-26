/**
 * @jects/spreadsheet — minimal, dependency-free ZIP read/write.
 *
 * Just enough of the ZIP (PKZIP / APPNOTE) container to assemble *and* parse an
 * `.xlsx` (Office Open XML) package. Entries are written with the **store**
 * method (compression method 0 — no DEFLATE), each with a correct CRC-32,
 * packed as local file headers + a central directory + an end-of-central-
 * directory record. Reading scans local file headers and returns the stored
 * bytes (store method only — which is exactly what {@link zipSync} produces).
 *
 * Storing uncompressed keeps this tiny and dependency-free while still producing
 * a fully valid archive Excel / LibreOffice accept (compression is optional in
 * the format). All paths are stored UTF-8 with the UTF-8 flag (bit 11) set.
 *
 * (Mirrors the proven `@jects/gantt` zip writer; the reader is added here so the
 * spreadsheet can round-trip its own `.xlsx` import.)
 */

/** One file to place in (or read from) the archive. */
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

/* ── UTF-8 helpers ──────────────────────────────────────────────────────── */

const ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined;
const DECODER = typeof TextDecoder !== 'undefined' ? new TextDecoder() : undefined;

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

/** Decode UTF-8 bytes to a string. */
export function fromUtf8(bytes: Uint8Array): string {
  if (DECODER) return DECODER.decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f),
      );
      i += 3;
    } else {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1]! & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f);
      const u = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
      i += 4;
    }
  }
  return out;
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

/* ── reading ────────────────────────────────────────────────────────────── */

function readU16(b: Uint8Array, p: number): number {
  return b[p]! | (b[p + 1]! << 8);
}
function readU32(b: Uint8Array, p: number): number {
  return (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0;
}

/**
 * Parse a `.zip` archive's local file entries into a `path → bytes` map. Only
 * the **store** method (0) is supported — which is what {@link zipSync} writes.
 * A DEFLATE-compressed entry (method 8) throws, since this minimal reader has no
 * inflate; the spreadsheet's own export never compresses.
 */
export function unzipSync(buffer: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  let p = 0;
  while (p + 4 <= buffer.length) {
    const sig = readU32(buffer, p);
    if (sig !== 0x04034b50) break; // first non-local-header (central dir) → done
    const method = readU16(buffer, p + 8);
    const compSize = readU32(buffer, p + 18);
    const nameLen = readU16(buffer, p + 26);
    const extraLen = readU16(buffer, p + 28);
    const nameStart = p + 30;
    const name = fromUtf8(buffer.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const data = buffer.subarray(dataStart, dataStart + compSize);
    if (method !== 0) {
      throw new Error(`Unsupported ZIP compression method ${method} for "${name}"`);
    }
    out.set(name, data.slice());
    p = dataStart + compSize;
  }
  if (out.size === 0) throw new Error('Not a valid (store-method) ZIP archive');
  return out;
}
