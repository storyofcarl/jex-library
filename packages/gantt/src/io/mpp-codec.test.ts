/**
 * jsdom unit tests for the native `.mpp` (OLE2/CFB binary) codec.
 *
 * Covers BOTH layers:
 *   - the generic CFB container (`mpp-ole2.ts`): magic, sector layout, FAT,
 *     mini-FAT for small streams, big-stream multi-sector chains, storage paths,
 *     and a full write→read round-trip;
 *   - the Gantt `.mpp` codec (`mpp-codec.ts`): bundle → native `.mpp` bytes →
 *     bundle, MSPDI-payload extraction, marker/provenance, and the tolerant /
 *     strict error paths.
 *
 * These run in the default (jsdom) `pnpm test` — they are pure byte logic and
 * need no browser. The a11y/visual proof lives in `mpp-codec.a11y.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  readCfb,
  writeCfb,
  isCfb,
  cfbNameCompare,
  CFB_SIGNATURE,
  type CfbStream,
} from './mpp-ole2.js';
import {
  exportMpp,
  importMpp,
  isMpp,
  roundTripMpp,
  listMppStreams,
  MPP_XML_STREAM,
  MPP_MARKER_STREAM,
} from './mpp-codec.js';
import { exportMsProject, type MsProjectBundle } from './msproject.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

const enc = new TextEncoder();
const dec = new TextDecoder();

function sampleBundle(): MsProjectBundle {
  return {
    name: 'Native MPP Sample',
    projectStart: T0,
    defaultCalendarId: 'std',
    tasks: [
      { id: 'p', name: 'Phase 1', summary: true },
      {
        id: 'a',
        name: 'Design',
        parentId: 'p',
        start: T0,
        end: T0 + 3 * DAY,
        duration: 3 * DAY,
        percentDone: 0.5,
      },
      {
        id: 'b',
        name: 'Build',
        parentId: 'p',
        start: T0 + 4 * DAY,
        end: T0 + 7 * DAY,
        duration: 3 * DAY,
      },
      {
        id: 'm',
        name: 'Launch',
        parentId: 'p',
        start: T0 + 7 * DAY,
        end: T0 + 7 * DAY,
        milestone: true,
      },
    ],
    dependencies: [
      { id: 'd1', fromId: 'a', toId: 'b', type: 'FS', lag: DAY },
      { id: 'd2', fromId: 'b', toId: 'm', type: 'FS' },
    ],
    calendars: [
      {
        id: 'std',
        name: 'Standard',
        week: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          intervals: [{ from: 480, to: 1020 }],
        })),
      },
    ],
    resources: [{ id: 'r1', name: 'Ada', type: 'work', maxUnits: 100, hourlyCost: 95 }],
    assignments: [{ id: 'as1', taskId: 'a', resourceId: 'r1', units: 100 }],
    baselines: [],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   CFB container (mpp-ole2.ts)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('CFB / OLE2 container', () => {
  it('writes a file beginning with the D0CF11E0 magic', () => {
    const bytes = writeCfb([{ name: 'Hello', path: '', data: enc.encode('world') }]);
    expect(isCfb(bytes)).toBe(true);
    for (let i = 0; i < 8; i++) expect(bytes[i]).toBe(CFB_SIGNATURE[i]);
    // header is 512 bytes + at least one sector
    expect(bytes.length).toBeGreaterThanOrEqual(512 + 512);
    // length is header + whole sectors
    expect((bytes.length - 512) % 512).toBe(0);
  });

  it('round-trips a single small (mini-FAT) stream', () => {
    const data = enc.encode('a short payload < 4096 bytes goes in the mini-stream');
    const bytes = writeCfb([{ name: 'Tiny', path: '', data }]);
    const { streams } = readCfb(bytes);
    expect(streams.has('Tiny')).toBe(true);
    expect(dec.decode(streams.get('Tiny')!.data)).toBe(dec.decode(data));
  });

  it('round-trips a big (FAT) stream spanning many sectors', () => {
    // > 4096 forces the regular FAT path + multiple sectors.
    const big = new Uint8Array(20_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7 + 3) & 0xff;
    const bytes = writeCfb([{ name: 'Big', path: '', data: big }]);
    const { streams } = readCfb(bytes);
    const got = streams.get('Big')!.data;
    expect(got.length).toBe(big.length);
    expect(Array.from(got.subarray(0, 64))).toEqual(Array.from(big.subarray(0, 64)));
    expect(Array.from(got.subarray(-64))).toEqual(Array.from(big.subarray(-64)));
  });

  it('round-trips multiple streams and preserves exact bytes', () => {
    const inputs: CfbStream[] = [
      { name: 'One', path: '', data: enc.encode('first') },
      { name: 'Two', path: '', data: enc.encode('second stream') },
      { name: 'Three', path: '', data: new Uint8Array([0, 1, 2, 3, 254, 255]) },
    ];
    const { streams } = readCfb(writeCfb(inputs));
    expect(streams.size).toBe(3);
    for (const inp of inputs) {
      const got = streams.get(inp.name)!.data;
      expect(Array.from(got)).toEqual(Array.from(inp.data));
    }
  });

  it('honours nested storage paths', () => {
    const bytes = writeCfb([
      { name: 'Leaf', path: 'Outer/Inner', data: enc.encode('deep') },
      { name: 'Top', path: '', data: enc.encode('top') },
    ]);
    const { streams } = readCfb(bytes);
    expect(streams.has('Outer/Inner/Leaf')).toBe(true);
    expect(dec.decode(streams.get('Outer/Inner/Leaf')!.data)).toBe('deep');
    expect(streams.get('Outer/Inner/Leaf')!.path).toBe('Outer/Inner');
    expect(streams.has('Top')).toBe(true);
  });

  it('round-trips a v4 (4096-byte sector) container', () => {
    const data = enc.encode('payload for the v4 variant');
    const bytes = writeCfb([{ name: 'V4', path: '', data }], { sectorSize: 4096 });
    expect((bytes.length - 512) % 4096).toBe(0);
    const { streams } = readCfb(bytes);
    expect(dec.decode(streams.get('V4')!.data)).toBe(dec.decode(data));
  });

  it('rejects non-CFB bytes', () => {
    expect(isCfb(enc.encode('<?xml version="1.0"?>'))).toBe(false);
    expect(() => readCfb(enc.encode('not a compound file'))).toThrow(/CFB|signature/i);
  });

  it('sorts directory siblings by CFB rule (length, then upper-case)', () => {
    expect(cfbNameCompare({ name: 'bb' }, { name: 'aaa' })).toBeLessThan(0); // shorter first
    expect(cfbNameCompare({ name: 'abc' }, { name: 'ABD' })).toBeLessThan(0); // case-insensitive
    expect(cfbNameCompare({ name: 'x' }, { name: 'x' })).toBe(0);
  });

  it('preserves a forced large stream set requiring DIFAT-free multi-FAT layout', () => {
    // ~5 streams of 30KB each → many sectors, exercising FAT growth fixpoint.
    const inputs: CfbStream[] = [];
    for (let s = 0; s < 5; s++) {
      const d = new Uint8Array(30_000);
      for (let i = 0; i < d.length; i++) d[i] = (i + s) & 0xff;
      inputs.push({ name: `S${s}`, path: '', data: d });
    }
    const { streams } = readCfb(writeCfb(inputs));
    for (const inp of inputs) {
      const got = streams.get(inp.name)!;
      expect(got.data.length).toBe(inp.data.length);
      expect(got.data[12345]).toBe(inp.data[12345]);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Native .mpp codec (mpp-codec.ts)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('native .mpp codec', () => {
  it('exports a bundle as a valid native .mpp binary', () => {
    const bytes = exportMpp(sampleBundle());
    expect(isMpp(bytes)).toBe(true);
    expect(isCfb(bytes)).toBe(true);
    // carries both our payload + marker streams
    const names = listMppStreams(bytes);
    expect(names).toContain(MPP_XML_STREAM);
    expect(names).toContain(MPP_MARKER_STREAM);
  });

  it('round-trips a full project through the binary container losslessly', () => {
    const original = sampleBundle();
    const { bundle, warnings, jectsAuthored, sourceStream } = roundTripMpp(original);
    expect(warnings).toEqual([]);
    expect(jectsAuthored).toBe(true);
    expect(sourceStream).toBe(MPP_XML_STREAM);

    expect(bundle.name).toBe('Native MPP Sample');
    expect(bundle.tasks.length).toBe(original.tasks.length);
    expect(bundle.dependencies.length).toBe(original.dependencies.length);
    expect(bundle.resources.length).toBe(original.resources.length);
    expect(bundle.assignments.length).toBe(original.assignments.length);

    const names = bundle.tasks.map((t) => t.name).sort();
    expect(names).toEqual(['Build', 'Design', 'Launch', 'Phase 1']);

    const milestone = bundle.tasks.find((t) => t.name === 'Launch');
    expect(milestone?.milestone).toBe(true);
    const dep = bundle.dependencies.find((d) => d.lag);
    expect(dep?.lag).toBe(DAY);
  });

  it('the embedded payload equals the MSPDI XML the XML codec would emit', () => {
    const b = sampleBundle();
    const expectedXml = exportMsProject(b);
    const bytes = exportMpp(b);
    const { streams } = readCfb(bytes);
    const embedded = dec.decode(streams.get(MPP_XML_STREAM)!.data);
    expect(embedded).toBe(expectedXml);
  });

  it('imports a third-party .mpp that embeds an MSPDI XML stream (not ours)', () => {
    // Simulate a foreign .mpp: an MSPDI document stored under an arbitrary stream
    // name, with NO Jects marker — the codec must still find + parse it.
    const xml = exportMsProject(sampleBundle());
    const foreign = writeCfb([
      { name: 'Props', path: '', data: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]) },
      { name: 'ProjectData', path: 'MSProject', data: enc.encode(xml) },
    ]);
    const { bundle, jectsAuthored, sourceStream, warnings } = importMpp(foreign);
    expect(jectsAuthored).toBe(false);
    expect(sourceStream).toBe('MSProject/ProjectData');
    expect(warnings).toEqual([]);
    expect(bundle.tasks.length).toBe(4);
  });

  it('tolerates a .mpp with no MSPDI payload (warning, empty bundle)', () => {
    const noXml = writeCfb([
      { name: 'Props', path: '', data: new Uint8Array(64).fill(0xaa) },
    ]);
    const res = importMpp(noXml);
    expect(res.bundle.tasks).toEqual([]);
    expect(res.warnings.length).toBe(1);
    expect(res.warnings[0]!.code).toBe('malformedXml');
  });

  it('throws in strict mode when no payload is present', () => {
    const noXml = writeCfb([
      { name: 'Props', path: '', data: new Uint8Array(64).fill(0xaa) },
    ]);
    expect(() => importMpp(noXml, { strict: true })).toThrow(/no MSPDI|not supported/i);
  });

  it('rejects MSPDI XML text passed to the binary importer', () => {
    const xml = exportMsProject(sampleBundle());
    expect(() => importMpp(enc.encode(xml))).toThrow(/not a native \.mpp|D0 CF 11 E0/i);
    expect(isMpp(xml)).toBe(false);
  });

  it('preserves calendars and baselines through the binary round-trip', () => {
    const b = sampleBundle();
    b.baselines = [
      {
        id: 'baseline',
        name: 'Baseline',
        takenAt: T0,
        tasks: new Map([
          ['a', { taskId: 'a', start: T0, end: T0 + 3 * DAY, duration: 3 * DAY }],
        ]),
      },
    ];
    const { bundle } = roundTripMpp(b);
    expect(bundle.calendars.length).toBe(1);
    // The MSPDI writer emits all 7 weekdays (working + non-working); the 5
    // working days must carry their interval.
    const working = bundle.calendars[0]!.week.filter((d) => d.intervals.length > 0);
    expect(working.length).toBe(5);
    expect(bundle.baselines.length).toBe(1);
    expect(bundle.baselines[0]!.tasks.has('a')).toBe(true);
  });

  it('respects the sectorSize export option (v4)', () => {
    const bytes = exportMpp(sampleBundle(), { sectorSize: 4096 });
    expect((bytes.length - 512) % 4096).toBe(0);
    const { bundle } = importMpp(bytes);
    expect(bundle.tasks.length).toBe(4);
  });
});
