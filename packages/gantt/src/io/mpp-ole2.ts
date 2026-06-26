/**
 * `@jects/gantt` — OLE2 / CFB (Compound File Binary) container codec.
 *
 * A native Microsoft Project `.mpp` file is **not** XML: it is an OLE2
 * "Structured Storage" / Compound File Binary (CFB) container — the same
 * MS-CFB format that older `.doc`/`.xls`/`.ppt` and `.msg` files use. The bytes
 * begin with the CFB magic `D0 CF 11 E0 A1 B1 1A E1`, then a 512-byte header,
 * a FAT/DIFAT sector chain, a mini-FAT for small streams, and a directory of
 * named storages and streams laid out as a red-black tree.
 *
 * This module is a **complete, dependency-free CFB reader and writer**: it can
 * parse an arbitrary `.mpp`/CFB file into its named streams, and synthesise a
 * valid CFB container from a set of named streams. It owns no DOM, imports no
 * framework code, and runs identically in jsdom, Node, and the browser — it
 * operates purely on `Uint8Array`/`ArrayBuffer`.
 *
 * Why it exists: MSPDI XML (handled by `msproject.ts`) is the documented
 * interchange format, but a true *native* `.mpp` round-trip requires reading and
 * writing the binary OLE2 envelope. `mpp-codec.ts` builds the Gantt-specific
 * `.mpp` mapping on top of this generic container layer; this file is the
 * container layer alone, fully testable in isolation.
 *
 * Scope discipline: this implements the CFB **container** (header, FAT, DIFAT,
 * mini-FAT, directory tree, stream read/write). It does not interpret the
 * proprietary MS Project record streams (`Props`, `Var2Data`, `TBkndTask`, …) —
 * those are an undocumented, version-specific binary blob. Instead the codec
 * above stores a portable MSPDI XML stream inside the container under a stable
 * name, so what we write is a real CFB file (openable by any CFB tool) and what
 * we emit round-trips losslessly. This mirrors how every framework-free Gantt
 * (Bryntum/DHTMLX) treats `.mpp`: the XML payload is the source of truth, the
 * OLE2 envelope is the transport.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   0. CONSTANTS (MS-CFB)
   ═══════════════════════════════════════════════════════════════════════════ */

/** CFB file magic: `D0 CF 11 E0 A1 B1 1A E1`. */
export const CFB_SIGNATURE = Object.freeze([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]) as readonly number[];

/** Sector-chain sentinel values (FAT entries). */
const FREESECT = 0xffffffff; // unallocated
const ENDOFCHAIN = 0xfffffffe; // last sector in a chain
const FATSECT = 0xfffffffd; // sector holds FAT
const DIFSECT = 0xfffffffc; // sector holds DIFAT
const NOSTREAM = 0xffffffff; // directory: no sibling/child

/** Directory entry object types. */
const OBJ_UNKNOWN = 0;
const OBJ_STORAGE = 1;
const OBJ_STREAM = 2;
const OBJ_ROOT = 5;

const DIR_ENTRY_SIZE = 128;
/** Streams smaller than this go in the mini-stream (mini-FAT), per MS-CFB. */
const MINI_STREAM_CUTOFF = 4096;

/* ═══════════════════════════════════════════════════════════════════════════
   1. PUBLIC TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

/** A named stream extracted from / written into a CFB container. */
export interface CfbStream {
  /** UTF-16 stream name (without storage path). */
  name: string;
  /** Slash-joined storage path of ancestors, e.g. `''` for root-level. */
  path: string;
  /** Raw stream bytes. */
  data: Uint8Array;
}

/** A parsed CFB container: its root CLSID plus every stream, by full path. */
export interface CfbContainer {
  /** All streams, keyed by full path (`path === '' ? name : path + '/' + name`). */
  streams: Map<string, CfbStream>;
  /** Root storage CLSID (16 bytes), if present. */
  rootClsid?: Uint8Array;
}

/** Options for {@link writeCfb}. */
export interface WriteCfbOptions {
  /**
   * Sector size: 512 (v3, the default and what MS Project writes) or 4096 (v4).
   * v3 is the most compatible.
   */
  sectorSize?: 512 | 4096;
  /** Root storage CLSID (16 bytes). Defaults to all-zero. */
  rootClsid?: Uint8Array;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. LITTLE-ENDIAN BYTE CURSOR HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** True if the first 8 bytes are the CFB magic. */
export function isCfb(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== CFB_SIGNATURE[i]) return false;
  }
  return true;
}

function u16(view: DataView, off: number): number {
  return view.getUint16(off, true);
}
function u32(view: DataView, off: number): number {
  return view.getUint32(off, true);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. READER  (CFB bytes → named streams)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Parse a CFB / OLE2 container into its named streams. Throws if the input is not
 * a CFB file (wrong magic) or is structurally truncated. Handles both 512-byte
 * (v3) and 4096-byte (v4) sectors, FAT + DIFAT chains, and the mini-FAT for
 * small streams.
 */
export function readCfb(bytes: Uint8Array): CfbContainer {
  if (!isCfb(bytes)) {
    throw new Error('Not a CFB/OLE2 file: missing D0CF11E0 signature.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // ── header ───────────────────────────────────────────────────────────────
  const sectorShift = u16(view, 30); // 9 ⇒ 512, 12 ⇒ 4096
  const sectorSize = 1 << sectorShift;
  const miniSectorShift = u16(view, 32); // normally 6 ⇒ 64
  const miniSectorSize = 1 << miniSectorShift;
  const numFatSectors = u32(view, 44);
  const firstDirSector = u32(view, 48);
  const miniStreamCutoff = u32(view, 56);
  const firstMiniFatSector = u32(view, 60);
  const numMiniFatSectors = u32(view, 64);
  const firstDifatSector = u32(view, 68);
  const numDifatSectors = u32(view, 72);

  const totalSectors = Math.max(0, Math.floor((bytes.length - 512) / sectorSize));

  /** Byte offset of sector `n` (sector 0 starts right after the 512-byte header). */
  const sectorOffset = (n: number): number => 512 + n * sectorSize;

  const readSectorU32 = (sector: number, index: number): number => {
    const off = sectorOffset(sector) + index * 4;
    if (off + 4 > bytes.length) return ENDOFCHAIN;
    return u32(view, off);
  };

  // ── DIFAT: list of FAT sector numbers ──────────────────────────────────────
  const fatSectors: number[] = [];
  // First 109 DIFAT entries live in the header (offset 76).
  for (let i = 0; i < 109 && fatSectors.length < numFatSectors; i++) {
    const s = u32(view, 76 + i * 4);
    if (s === FREESECT || s === ENDOFCHAIN) break;
    fatSectors.push(s);
  }
  // Remaining DIFAT entries live in a chain of DIFAT sectors.
  {
    let difSector = firstDifatSector;
    const perSector = sectorSize / 4 - 1; // last slot is the next-DIFAT pointer
    let guard = 0;
    while (
      difSector !== ENDOFCHAIN &&
      difSector !== FREESECT &&
      guard++ < totalSectors + 1 &&
      fatSectors.length < numFatSectors
    ) {
      for (let i = 0; i < perSector && fatSectors.length < numFatSectors; i++) {
        const s = readSectorU32(difSector, i);
        if (s === FREESECT || s === ENDOFCHAIN) break;
        fatSectors.push(s);
      }
      difSector = readSectorU32(difSector, sectorSize / 4 - 1);
    }
    void numDifatSectors;
  }

  // ── FAT: flat array of next-sector pointers ─────────────────────────────────
  const entriesPerSector = sectorSize / 4;
  const fat: number[] = [];
  for (const fs of fatSectors) {
    for (let i = 0; i < entriesPerSector; i++) {
      fat.push(readSectorU32(fs, i));
    }
  }

  /** Follow a FAT chain from `start`, concatenating each sector's bytes. */
  const readChain = (start: number): Uint8Array => {
    const parts: Uint8Array[] = [];
    let sector = start;
    let guard = 0;
    while (
      sector !== ENDOFCHAIN &&
      sector !== FREESECT &&
      guard++ <= totalSectors + 1
    ) {
      const off = sectorOffset(sector);
      parts.push(bytes.subarray(off, Math.min(off + sectorSize, bytes.length)));
      sector = fat[sector] ?? ENDOFCHAIN;
    }
    return concat(parts);
  };

  // ── directory stream → entries ──────────────────────────────────────────────
  const dirBytes = readChain(firstDirSector);
  const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const entryCount = Math.floor(dirBytes.length / DIR_ENTRY_SIZE);

  interface DirEntry {
    name: string;
    type: number;
    left: number;
    right: number;
    child: number;
    startSector: number;
    size: number;
    clsid: Uint8Array;
  }
  const entries: DirEntry[] = [];
  for (let e = 0; e < entryCount; e++) {
    const base = e * DIR_ENTRY_SIZE;
    const nameLen = u16(dirView, base + 64); // bytes incl. terminating NUL
    let name = '';
    for (let c = 0; c + 1 < nameLen; c += 2) {
      const code = u16(dirView, base + c);
      if (code === 0) break;
      name += String.fromCharCode(code);
    }
    const type = dirBytes[base + 66] ?? OBJ_UNKNOWN;
    entries.push({
      name,
      type,
      left: u32(dirView, base + 68),
      right: u32(dirView, base + 72),
      child: u32(dirView, base + 76),
      startSector: u32(dirView, base + 116),
      size: u32(dirView, base + 120),
      clsid: dirBytes.subarray(base + 80, base + 96),
    });
  }

  // The root entry (#0) holds the mini-stream as its own chain.
  const root = entries[0];
  const miniStream = root ? readChain(root.startSector) : new Uint8Array(0);

  // mini-FAT
  const miniFatBytes = numMiniFatSectors > 0 || firstMiniFatSector !== ENDOFCHAIN
    ? readChain(firstMiniFatSector)
    : new Uint8Array(0);
  const miniFatView = new DataView(
    miniFatBytes.buffer,
    miniFatBytes.byteOffset,
    miniFatBytes.byteLength,
  );
  const miniFat: number[] = [];
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) {
    miniFat.push(miniFatView.getUint32(i, true));
  }

  /** Read a stream that lives in the mini-stream (small stream). */
  const readMiniChain = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(size);
    let sector = start;
    let written = 0;
    let guard = 0;
    while (
      sector !== ENDOFCHAIN &&
      sector !== FREESECT &&
      written < size &&
      guard++ <= miniFat.length + 1
    ) {
      const off = sector * miniSectorSize;
      const take = Math.min(miniSectorSize, size - written);
      out.set(miniStream.subarray(off, off + take), written);
      written += take;
      sector = miniFat[sector] ?? ENDOFCHAIN;
    }
    return out;
  };

  const cutoff = miniStreamCutoff || MINI_STREAM_CUTOFF;
  void miniSectorSize;

  // ── walk the directory red-black tree, recording full paths ────────────────
  const streams = new Map<string, CfbStream>();
  const visit = (index: number, prefix: string): void => {
    if (index === NOSTREAM || index >= entries.length) return;
    const en = entries[index]!;
    visit(en.left, prefix);
    if (en.type === OBJ_STREAM) {
      const data =
        en.size < cutoff
          ? readMiniChain(en.startSector, en.size)
          : readChain(en.startSector).subarray(0, en.size);
      const full = prefix === '' ? en.name : `${prefix}/${en.name}`;
      streams.set(full, { name: en.name, path: prefix, data });
    } else if (en.type === OBJ_STORAGE) {
      const childPrefix = prefix === '' ? en.name : `${prefix}/${en.name}`;
      visit(en.child, childPrefix);
    }
    visit(en.right, prefix);
  };
  if (root && root.child !== NOSTREAM) visit(root.child, '');

  const container: CfbContainer = { streams };
  if (root && root.clsid.some((b) => b !== 0)) {
    container.rootClsid = root.clsid.slice();
  }
  return container;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. WRITER  (named streams → CFB bytes)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Synthesise a valid CFB / OLE2 container from a flat list of named streams.
 * Produces a v3 (512-byte sector) file by default — the most compatible variant,
 * and what MS Project itself writes. Storage paths are honoured: a stream with
 * `path: 'Sub'` is placed inside a `Sub` storage. The output is byte-for-byte
 * re-readable by {@link readCfb} and openable by any conformant CFB reader.
 *
 * The directory is laid out as a simple (left-leaning) red-black-compatible
 * tree: siblings are chained through the `right` pointer in sorted order, which
 * is a valid CFB tree (readers tolerate unbalanced trees; balance only affects
 * lookup speed, never correctness).
 */
export function writeCfb(input: CfbStream[], options: WriteCfbOptions = {}): Uint8Array {
  const sectorSize = options.sectorSize ?? 512;
  const sectorShift = sectorSize === 4096 ? 12 : 9;
  const miniSectorShift = 6;
  const miniSectorSize = 1 << miniSectorShift;
  const cutoff = MINI_STREAM_CUTOFF;

  /* ── build the storage/stream tree ───────────────────────────────────────── */
  interface Node {
    name: string;
    type: number;
    clsid: Uint8Array;
    data?: Uint8Array;
    children: Map<string, Node>;
    // assigned later:
    dirIndex: number;
    child: number;
    left: number;
    right: number;
    startSector: number;
    size: number;
  }
  const makeNode = (name: string, type: number): Node => ({
    name,
    type,
    clsid: new Uint8Array(16),
    children: new Map(),
    dirIndex: -1,
    child: NOSTREAM,
    left: NOSTREAM,
    right: NOSTREAM,
    startSector: ENDOFCHAIN,
    size: 0,
  });

  const root = makeNode('Root Entry', OBJ_ROOT);
  if (options.rootClsid && options.rootClsid.length === 16) {
    root.clsid = options.rootClsid.slice();
  }

  for (const s of input) {
    const segments = s.path === '' ? [] : s.path.split('/');
    let cursor = root;
    for (const seg of segments) {
      let next = cursor.children.get(seg);
      if (!next) {
        next = makeNode(seg, OBJ_STORAGE);
        cursor.children.set(seg, next);
      }
      cursor = next;
    }
    const leaf = makeNode(s.name, OBJ_STREAM);
    leaf.data = s.data;
    leaf.size = s.data.length;
    cursor.children.set(s.name, leaf);
  }

  /* ── assign directory indices (BFS, root first) ──────────────────────────── */
  const dirEntries: Node[] = [root];
  root.dirIndex = 0;
  const assign = (node: Node): void => {
    const kids = [...node.children.values()];
    // CFB sorts directory siblings by (name length, then uppercase name).
    kids.sort(cfbNameCompare);
    for (const k of kids) {
      k.dirIndex = dirEntries.length;
      dirEntries.push(k);
    }
    // Build a balanced BST over the sorted siblings; left/right form a valid,
    // in-order CFB directory tree, and `child` points at the subtree root.
    const buildBst = (lo: number, hi: number): number => {
      if (lo > hi) return NOSTREAM;
      const mid = (lo + hi) >> 1;
      const k = kids[mid]!;
      k.left = buildBst(lo, mid - 1);
      k.right = buildBst(mid + 1, hi);
      return k.dirIndex;
    };
    node.child = buildBst(0, kids.length - 1);
    for (const k of kids) assign(k);
  };
  assign(root);

  /* ── collect big-stream data + mini-stream data ──────────────────────────── */
  const bigStreams: Node[] = [];
  const miniStreams: Node[] = [];
  for (const node of dirEntries) {
    if (node.type !== OBJ_STREAM || !node.data) continue;
    if (node.data.length >= cutoff) bigStreams.push(node);
    else if (node.data.length > 0) miniStreams.push(node);
  }

  /* ── lay out the mini-stream (concatenation of mini-sector-aligned data) ──── */
  const miniFat: number[] = [];
  const miniParts: Uint8Array[] = [];
  let miniSectorCount = 0;
  for (const node of miniStreams) {
    const start = miniSectorCount;
    const sectors = Math.ceil(node.data!.length / miniSectorSize);
    for (let i = 0; i < sectors; i++) {
      miniFat.push(i === sectors - 1 ? ENDOFCHAIN : miniSectorCount + i + 1);
    }
    const padded = new Uint8Array(sectors * miniSectorSize);
    padded.set(node.data!);
    miniParts.push(padded);
    node.startSector = start;
    miniSectorCount += sectors;
  }
  const miniStreamBytes = concat(miniParts);
  // mini-FAT is itself padded to whole FAT entries-per-sector.
  while (miniFat.length % (sectorSize / 4) !== 0 && miniFat.length > 0) {
    miniFat.push(FREESECT);
  }

  /* ── now plan the regular sectors. Order:
       [ mini-stream sectors ][ mini-FAT sectors ][ directory sectors ]
       [ big-stream sectors ] — FAT/DIFAT computed last over the total.       */
  const entriesPerSector = sectorSize / 4;
  const fat: number[] = [];
  const dataSectors: Uint8Array[] = [];

  /** Append `payload` (already sector-padded) as a chain; return start sector. */
  const appendChain = (payload: Uint8Array): number => {
    const sectors = payload.length / sectorSize;
    if (sectors === 0) return ENDOFCHAIN;
    const start = dataSectors.length;
    for (let i = 0; i < sectors; i++) {
      const slice = payload.subarray(i * sectorSize, (i + 1) * sectorSize);
      dataSectors.push(slice);
      fat.push(i === sectors - 1 ? ENDOFCHAIN : start + i + 1);
    }
    return start;
  };

  const padSectors = (data: Uint8Array): Uint8Array => {
    const sectors = Math.ceil(data.length / sectorSize) || 0;
    if (sectors === 0) return new Uint8Array(0);
    const out = new Uint8Array(sectors * sectorSize);
    out.set(data);
    return out;
  };

  // (a) mini-stream — its chain start is recorded on the ROOT entry.
  const miniStreamStart = miniStreamBytes.length
    ? appendChain(padSectors(miniStreamBytes))
    : ENDOFCHAIN;
  root.startSector = miniStreamStart;
  root.size = miniStreamBytes.length;

  // (b) mini-FAT sectors
  const miniFatBytes = encodeU32(miniFat);
  const firstMiniFatSector = miniFatBytes.length
    ? appendChain(padSectors(miniFatBytes))
    : ENDOFCHAIN;
  const numMiniFatSectors = miniFatBytes.length ? miniFatBytes.length / sectorSize : 0;

  // (c) big streams
  for (const node of bigStreams) {
    node.startSector = appendChain(padSectors(node.data!));
  }

  // (d) directory sectors — built after start sectors are known.
  const dirBytes = buildDirectory(dirEntries, entriesPerSector);
  const firstDirSector = appendChain(dirBytes);
  const numDirSectors = dirBytes.length / sectorSize;

  /* ── FAT + DIFAT. We must reserve sectors for the FAT itself, which grows
       the total, which can grow the FAT — iterate to a fixed point.          */
  const dataSectorCount = dataSectors.length;
  let numFatSectors = 0;
  let numDifatSectors = 0;
  for (;;) {
    const difatInHeader = 109;
    const difatPerSector = entriesPerSector - 1;
    const totalSectorsNow = dataSectorCount + numFatSectors + numDifatSectors;
    const neededFat = Math.ceil(totalSectorsNow / entriesPerSector) || 1;
    let neededDifat = 0;
    if (neededFat > difatInHeader) {
      neededDifat = Math.ceil((neededFat - difatInHeader) / difatPerSector);
    }
    if (neededFat === numFatSectors && neededDifat === numDifatSectors) break;
    numFatSectors = neededFat;
    numDifatSectors = neededDifat;
  }

  // Sector numbers for FAT + DIFAT come after all data sectors.
  const fatSectorNums: number[] = [];
  for (let i = 0; i < numFatSectors; i++) fatSectorNums.push(dataSectorCount + i);
  const difatSectorNums: number[] = [];
  for (let i = 0; i < numDifatSectors; i++) {
    difatSectorNums.push(dataSectorCount + numFatSectors + i);
  }

  // Extend the FAT to cover FAT + DIFAT sectors with their marker values.
  while (fat.length < dataSectorCount) fat.push(FREESECT);
  for (const s of fatSectorNums) fat[s] = FATSECT;
  for (const s of difatSectorNums) fat[s] = DIFSECT;
  // Pad FAT to a whole number of FAT sectors with FREESECT.
  const totalFatEntries = numFatSectors * entriesPerSector;
  while (fat.length < totalFatEntries) fat.push(FREESECT);

  // Encode the FAT into its reserved sectors.
  const fatBytes = encodeU32(fat);
  const fatSectorsData = padSectors(fatBytes);

  // DIFAT: first 109 in header, rest chained through DIFAT sectors.
  const headerDifat: number[] = [];
  for (let i = 0; i < Math.min(109, numFatSectors); i++) {
    headerDifat.push(fatSectorNums[i]!);
  }
  const difatSectorsData = new Uint8Array(numDifatSectors * sectorSize);
  {
    const dv = new DataView(difatSectorsData.buffer);
    let fatIdx = 109;
    for (let s = 0; s < numDifatSectors; s++) {
      const base = s * sectorSize;
      for (let i = 0; i < entriesPerSector - 1; i++) {
        const val = fatIdx < numFatSectors ? fatSectorNums[fatIdx]! : FREESECT;
        dv.setUint32(base + i * 4, val, true);
        fatIdx++;
      }
      const nextDifat =
        s + 1 < numDifatSectors ? difatSectorNums[s + 1]! : ENDOFCHAIN;
      dv.setUint32(base + (entriesPerSector - 1) * 4, nextDifat, true);
    }
  }

  /* ── assemble the final byte image ───────────────────────────────────────── */
  const totalSectors = dataSectorCount + numFatSectors + numDifatSectors;
  const total = new Uint8Array(512 + totalSectors * sectorSize);
  const out = new DataView(total.buffer);

  // header
  for (let i = 0; i < 8; i++) total[i] = CFB_SIGNATURE[i]!;
  // CLSID (16 bytes @ 8) left zero. minor/major version:
  out.setUint16(24, 0x003e, true); // minor version
  out.setUint16(26, sectorSize === 4096 ? 0x0004 : 0x0003, true); // major version
  out.setUint16(28, 0xfffe, true); // byte order LE
  out.setUint16(30, sectorShift, true);
  out.setUint16(32, miniSectorShift, true);
  // reserved (6 bytes) zero
  out.setUint32(40, 0, true); // number of dir sectors (0 for v3)
  out.setUint32(44, numFatSectors, true);
  out.setUint32(48, firstDirSector, true);
  out.setUint32(52, 0, true); // transaction signature
  out.setUint32(56, MINI_STREAM_CUTOFF, true);
  out.setUint32(60, firstMiniFatSector, true);
  out.setUint32(64, numMiniFatSectors, true);
  out.setUint32(68, numDifatSectors ? difatSectorNums[0]! : ENDOFCHAIN, true);
  out.setUint32(72, numDifatSectors, true);
  // header DIFAT (109 entries @ 76)
  for (let i = 0; i < 109; i++) {
    out.setUint32(76 + i * 4, i < headerDifat.length ? headerDifat[i]! : FREESECT, true);
  }
  void numDirSectors;

  // sector payloads
  let cursor = 512;
  const writeBlock = (block: Uint8Array): void => {
    total.set(block, cursor);
    cursor += block.length;
  };
  // data sectors (mini-stream, mini-FAT, big streams, directory) in append order
  for (const sec of dataSectors) {
    // each `sec` is exactly sectorSize (padSectors guarantees it)
    total.set(sec, cursor);
    cursor += sectorSize;
  }
  void writeBlock;
  // FAT sectors
  total.set(fatSectorsData, cursor);
  cursor += fatSectorsData.length;
  // DIFAT sectors
  total.set(difatSectorsData, cursor);
  cursor += difatSectorsData.length;

  return total;

  /* ── local helpers ───────────────────────────────────────────────────────── */

  function buildDirectory(nodes: Node[], _eps: number): Uint8Array {
    // Pad entry count to a whole number of sectors.
    const perSector = sectorSize / DIR_ENTRY_SIZE;
    const padded = Math.ceil(Math.max(nodes.length, 1) / perSector) * perSector;
    const buf = new Uint8Array(padded * DIR_ENTRY_SIZE);
    const dv = new DataView(buf.buffer);
    for (let i = 0; i < padded; i++) {
      const base = i * DIR_ENTRY_SIZE;
      const node = nodes[i];
      if (!node) {
        // unused slot: type UNKNOWN, all sibling/child = NOSTREAM
        buf[base + 66] = OBJ_UNKNOWN;
        dv.setUint32(base + 68, NOSTREAM, true);
        dv.setUint32(base + 72, NOSTREAM, true);
        dv.setUint32(base + 76, NOSTREAM, true);
        continue;
      }
      // name (UTF-16LE, NUL-terminated)
      const nameLen = Math.min(node.name.length, 31);
      for (let c = 0; c < nameLen; c++) {
        dv.setUint16(base + c * 2, node.name.charCodeAt(c), true);
      }
      dv.setUint16(base + nameLen * 2, 0, true); // terminator
      dv.setUint16(base + 64, (nameLen + 1) * 2, true); // name length in bytes
      buf[base + 66] = node.type;
      buf[base + 67] = node.type === OBJ_ROOT ? 0 : 1; // color: 0=red,1=black
      dv.setUint32(base + 68, node.left, true);
      dv.setUint32(base + 72, node.right, true);
      dv.setUint32(base + 76, node.child, true);
      buf.set(node.clsid, base + 80);
      // state bits (84), times (96..112) left zero
      dv.setUint32(base + 116, node.startSector, true);
      dv.setUint32(base + 120, node.size, true);
      dv.setUint32(base + 124, 0, true); // high dword of size (v3)
    }
    return buf;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. SHARED UTILITIES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Concatenate a list of byte arrays. */
export function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Encode a list of u32 little-endian. */
function encodeU32(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 4);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < values.length; i++) dv.setUint32(i * 4, values[i]! >>> 0, true);
  return buf;
}

/**
 * CFB directory sibling order: shorter names sort first; ties broken by the
 * upper-cased UTF-16 name. This is the exact comparator MS-CFB mandates so the
 * tree is well-formed and readers find entries.
 */
export function cfbNameCompare(a: { name: string }, b: { name: string }): number {
  if (a.name.length !== b.name.length) return a.name.length - b.name.length;
  const ua = a.name.toUpperCase();
  const ub = b.name.toUpperCase();
  return ua < ub ? -1 : ua > ub ? 1 : 0;
}
