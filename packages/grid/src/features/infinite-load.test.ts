/** jsdom unit tests for InfiniteLoadFeature (lazy / infinite load-on-demand). */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ColumnDef, ViewportWindow } from '../contract.js';
import {
  InfiniteLoadFeature,
  infiniteLoadFeature,
  isLoadingRecord,
  placeholderIdFor,
  LOADING_FLAG,
  type RangeRequest,
  type RangeResponse,
} from './infinite-load.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  name: string;
  [LOADING_FLAG]?: boolean;
}

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'id', header: 'ID' },
  { field: 'name', header: 'Name' },
];

/** Build a server stub that returns rows for any requested range. */
function makeServer(total: number) {
  const calls: RangeRequest[] = [];
  const load = vi.fn(
    (req: RangeRequest): RangeResponse<Row> => {
      calls.push(req);
      const rows: Row[] = [];
      for (let i = req.start; i < req.end; i++) {
        rows.push({ id: i, name: `Row ${i}` });
      }
      return { rows, totalCount: total };
    },
  );
  return { load, calls };
}

/** Make a harness whose viewport window can be driven programmatically. */
function makeDrivableHarness(): {
  h: FeatureHarness<Row>;
  setWindow(start: number, end: number): void;
} {
  // Start with an empty store; the feature fills it with placeholders.
  const h = makeHarness<Row>({ store: makeStore<Row>([]), columns: COLUMNS });
  const win = h.api.viewport.window as ViewportWindow;
  const setWindow = (start: number, end: number): void => {
    (win as { startIndex: number }).startIndex = start;
    (win as { endIndex: number }).endIndex = end;
    h.api.emit('viewportChange', { window: win });
  };
  return { h, setWindow };
}

let h: FeatureHarness<Row>;
afterEach(() => h?.destroy());

describe('InfiniteLoadFeature (jsdom)', () => {
  it('sizes the store to totalCount with loading placeholders on init', () => {
    h = makeHarness<Row>({ store: makeStore<Row>([]), columns: COLUMNS });
    h.api.use(infiniteLoadFeature<Row>({ totalCount: 120, loadRange: () => ({ rows: [] }) }));
    expect(h.api.getRowCount()).toBe(120);
    const r0 = h.api.getRow(0)!;
    expect(isLoadingRecord(r0)).toBe(true);
    expect(h.api.getRowById(placeholderIdFor(5))).toBeDefined();
  });

  it('requires a loadRange callback', () => {
    expect(
      () => new InfiniteLoadFeature<Row>({ totalCount: 1 } as never),
    ).toThrow(/loadRange/);
  });

  it('auto-loads the first page on init and replaces placeholders with real rows', async () => {
    const server = makeServer(200);
    h = makeHarness<Row>({ store: makeStore<Row>([]), columns: COLUMNS });
    const f = h.api.use(
      infiniteLoadFeature<Row>({ totalCount: 200, pageSize: 50, loadRange: server.load }),
    ) as InfiniteLoadFeature<Row>;

    await Promise.resolve();
    await Promise.resolve();

    expect(server.calls[0]).toMatchObject({ start: 0, end: 50, page: 0, pageSize: 50 });
    const r0 = h.api.getRowById(0)!;
    expect(r0.name).toBe('Row 0');
    expect(isLoadingRecord(r0)).toBe(false);
    expect(f.isLoaded(0)).toBe(true);
    // Rows beyond the first page are still placeholders.
    expect(f.isPlaceholder(100)).toBe(true);
  });

  it('does not auto-load when autoLoad is false', async () => {
    const server = makeServer(50);
    h = makeHarness<Row>({ store: makeStore<Row>([]), columns: COLUMNS });
    h.api.use(
      infiniteLoadFeature<Row>({ totalCount: 50, loadRange: server.load, autoLoad: false }),
    );
    await Promise.resolve();
    expect(server.load).not.toHaveBeenCalled();
  });

  it('prefetches the page a scrolled viewport approaches (threshold lookahead)', async () => {
    const server = makeServer(1000);
    const { h: hh, setWindow } = makeDrivableHarness();
    h = hh;
    h.api.use(
      infiniteLoadFeature<Row>({
        totalCount: 1000,
        pageSize: 100,
        prefetchThreshold: 20,
        autoLoad: false,
        loadRange: server.load,
      }),
    );

    // Scroll so the window ends at 85; with +20 lookahead that reaches index 105
    // → page 1 must be fetched (and page 0, which the window still overlaps).
    setWindow(40, 85);
    await Promise.resolve();
    await Promise.resolve();

    const pages = server.calls.map((c) => c.page).sort((a, b) => a - b);
    expect(pages).toContain(0);
    expect(pages).toContain(1);
  });

  it('never requests the same page twice', async () => {
    const server = makeServer(300);
    const { h: hh, setWindow } = makeDrivableHarness();
    h = hh;
    h.api.use(
      infiniteLoadFeature<Row>({
        totalCount: 300,
        pageSize: 100,
        autoLoad: false,
        loadRange: server.load,
      }),
    );
    setWindow(0, 40);
    setWindow(10, 50);
    setWindow(20, 60);
    await Promise.resolve();
    await Promise.resolve();
    const page0Requests = server.calls.filter((c) => c.page === 0).length;
    expect(page0Requests).toBe(1);
  });

  it('updates totalCount from a response and resizes the virtual list', async () => {
    const server = {
      load: vi.fn(
        (req: RangeRequest): RangeResponse<Row> => ({
          rows: Array.from({ length: req.end - req.start }, (_, k) => ({
            id: req.start + k,
            name: `R${req.start + k}`,
          })),
          totalCount: 42, // server reveals the real total
        }),
      ),
    };
    h = makeHarness<Row>({ store: makeStore<Row>([]), columns: COLUMNS });
    const f = h.api.use(
      infiniteLoadFeature<Row>({ totalCount: 10, pageSize: 10, loadRange: server.load }),
    ) as InfiniteLoadFeature<Row>;
    await Promise.resolve();
    await Promise.resolve();
    expect(f.totalCount).toBe(42);
    expect(h.api.getRowCount()).toBe(42);
  });

  it('reports an error page state when the loader rejects', async () => {
    const f = (() => {
      h = makeHarness<Row>({ store: makeStore<Row>([]), columns: COLUMNS });
      return h.api.use(
        infiniteLoadFeature<Row>({
          totalCount: 20,
          pageSize: 10,
          loadRange: () => Promise.reject(new Error('boom')),
        }),
      ) as InfiniteLoadFeature<Row>;
    })();
    // Let the rejection settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(f.pageStateOf(0)).toBe('error');
    // The row stays a placeholder after a failed load.
    expect(f.isPlaceholder(0)).toBe(true);
  });

  it('loadAround forces a (re)load of a specific page', async () => {
    const server = makeServer(100);
    h = makeHarness<Row>({ store: makeStore<Row>([]), columns: COLUMNS });
    const f = h.api.use(
      infiniteLoadFeature<Row>({
        totalCount: 100,
        pageSize: 25,
        autoLoad: false,
        loadRange: server.load,
      }),
    ) as InfiniteLoadFeature<Row>;
    await f.loadAround(60); // index 60 → page 2 (50..75)
    expect(server.calls.some((c) => c.page === 2)).toBe(true);
    expect(h.api.getRowById(60)!.name).toBe('Row 60');
  });

  it('reset() re-skeletonizes the whole list', async () => {
    const server = makeServer(60);
    h = makeHarness<Row>({ store: makeStore<Row>([]), columns: COLUMNS });
    const f = h.api.use(
      infiniteLoadFeature<Row>({ totalCount: 60, pageSize: 30, loadRange: server.load }),
    ) as InfiniteLoadFeature<Row>;
    await Promise.resolve();
    await Promise.resolve();
    expect(f.isPlaceholder(0)).toBe(false);
    f.reset();
    expect(f.loadedPageCount()).toBe(0);
    // After reset everything is a placeholder again until the auto reload lands.
    expect(isLoadingRecord(h.api.getRow(40))).toBe(true);
  });

  it('decorates painted placeholder rows with --loading + aria-busy', async () => {
    const server = makeServer(40);
    h = makeHarness<Row>({ store: makeStore<Row>([]), columns: COLUMNS });
    h.api.use(
      infiniteLoadFeature<Row>({
        totalCount: 40,
        pageSize: 20,
        autoLoad: false,
        loadRange: server.load,
      }),
    );

    // Simulate the renderer having painted two rows: one placeholder, one loaded.
    const loaded = h.api.getRow(0)!;
    // Manually load row 0 by faking its content.
    delete (loaded as Record<string, unknown>)[LOADING_FLAG];
    (loaded as Row).name = 'real';

    const rowReal = document.createElement('div');
    rowReal.className = 'jects-grid__row';
    rowReal.dataset['rowId'] = String(placeholderIdFor(0)); // still keyed by placeholder id in store
    const rowPh = document.createElement('div');
    rowPh.className = 'jects-grid__row';
    rowPh.dataset['rowId'] = String(placeholderIdFor(30));
    h.api.el.append(rowReal, rowPh);

    // Trigger a repaint cycle → decorate runs.
    h.api.emit('viewportChange', { window: h.api.viewport.window });

    expect(rowPh.classList.contains('jects-grid__row--loading')).toBe(true);
    expect(rowPh.getAttribute('aria-busy')).toBe('true');
    expect(rowReal.classList.contains('jects-grid__row--loading')).toBe(false);
    expect(rowReal.getAttribute('aria-busy')).toBeNull();
  });

  it('disposes cleanly: no listeners fire after destroy', async () => {
    const server = makeServer(40);
    h = makeHarness<Row>({ store: makeStore<Row>([]), columns: COLUMNS });
    const f = h.api.use(
      infiniteLoadFeature<Row>({ totalCount: 40, pageSize: 20, autoLoad: false, loadRange: server.load }),
    ) as InfiniteLoadFeature<Row>;
    f.destroy();
    const before = server.load.mock.calls.length;
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    h.api.emit('scroll', { scrollTop: 999, scrollLeft: 0 });
    await Promise.resolve();
    expect(server.load.mock.calls.length).toBe(before);
  });
});
