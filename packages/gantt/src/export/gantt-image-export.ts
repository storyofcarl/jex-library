/**
 * `GanttImageExportFeature` — wires the orphaned PNG/image raster export
 * (`./png`) into a live `Gantt` as a real, reachable public feature, WITHOUT
 * editing the `Gantt` widget class, the frozen contract, or any other shared
 * module. This is the missing-parity "Export to PNG/image" wiring: the `./png`
 * module already implements the full-chart rasterize (serialize → foreignObject
 * → canvas → Blob/data-URL) and is browser-tested, but nothing exposed it on the
 * widget. This feature is that bridge.
 *
 * ## Design (concurrency-safe, contract-pure)
 *   - It is a `GanttFeature` — installed via
 *     `gantt.use(new GanttImageExportFeature())` or
 *     `new Gantt(el, { plugins: [new GanttImageExportFeature()] })`, or the
 *     `installImageExport(gantt)` convenience. It touches ONLY the public
 *     `GanttApi` surface (`el`, `track`) — never the widget internals.
 *   - On `init(api)` it constructs a {@link GanttImageExporter} bound to the
 *     Gantt root element (`api.el`), then augments the live api/widget object
 *     with `exportPng()`, `exportImage()`, `exportImageDataUrl()`,
 *     `serializeImage()`, and an `imageExporter` accessor — additively, via
 *     defined own-properties, so a consumer can call `gantt.exportPng()`
 *     directly. The augmentation is removed again on `destroy()`/`removeFeature`,
 *     and the exporter is disposed, so teardown leaks nothing.
 *   - The `'.jects-gantt__timeline-scroller'` / `'.jects-gantt__tree-scroller'`
 *     selectors the underlying exporter relies on are exactly the class names the
 *     widget renders (timeline-view.ts / task-tree.ts), so the full-chart capture
 *     finds the panes on a real `Gantt` root.
 *
 * ## Why a feature and not a method on the class
 * Other feature agents edit `gantt.ts` in parallel; mutating the class would
 * conflict and risk the frozen-contract surface. A `GanttFeature` is the
 * package's established additive extension seam (see `GanttIndicatorsFeature`,
 * `ProjectLines`, `GanttPrintController`). The integrator can optionally promote
 * `exportPng()`/`exportImage()` to first-class methods on `Gantt`; see the wire
 * notes returned with this change.
 */

import type { Model } from '@jects/core';
import type { GanttApi, GanttFeature } from '../contract.js';
import {
  GanttImageExporter,
  type GanttImageExportOptions,
  type GanttSvgExport,
  type GanttExportSize,
  type GanttPngOptions,
} from './png.js';

/** Registry name this feature installs under (`gantt.features.get(...)`). */
export const GANTT_IMAGE_EXPORT_FEATURE = 'gantt-image-export';

/** Construction config for {@link GanttImageExportFeature}. */
export interface GanttImageExportFeatureConfig {
  /**
   * Default options merged into every `exportPng()`/`exportImage()` call (the
   * per-call options win). Lets a consumer set, e.g., a project-wide
   * `pixelRatio`/`padding`/`background` once at install time.
   */
  defaults?: GanttImageExportOptions;
  /**
   * Element whose computed `--jects-*` token cascade is inlined into the export
   * (defaults to the Gantt root). Override to resolve tokens from a themed
   * ancestor when the root itself does not carry the theme.
   */
  host?: HTMLElement;
}

/**
 * The image-export surface this feature grafts onto the Gantt instance. After
 * `gantt.use(new GanttImageExportFeature())`, the `gantt` object satisfies
 * {@link GanttWithImageExport} and these methods are callable directly.
 */
export interface GanttImageExportApi {
  /**
   * Rasterize the full export-rendered Gantt (task tree + timeline header + bars
   * + dependency SVG) to a PNG `Blob`. Resolves `null` outside a real browser
   * (jsdom) so callers can fall back to the SVG/print path. When
   * `opts.download` is set, the Blob is also offered as a file download.
   */
  exportPng(opts?: GanttImageExportOptions): Promise<Blob | null>;
  /**
   * Like {@link exportPng} but honors `opts.type` (`image/png` | `image/jpeg` |
   * `image/webp`); defaults to PNG. The general-purpose image export entry.
   */
  exportImage(opts?: GanttImageExportOptions): Promise<Blob | null>;
  /** Rasterize the Gantt to a `data:` URL (PNG by default). `null` under jsdom. */
  exportImageDataUrl(opts?: GanttImageExportOptions): Promise<string | null>;
  /** Serialize the (full-chart) Gantt to a standalone SVG export descriptor. */
  serializeImage(opts?: GanttImageExportOptions): GanttSvgExport;
  /** The export-rendered (fully expanded) chart size in CSS px. */
  measureImage(opts?: Pick<GanttPngOptions, 'fullChart' | 'padding'>): GanttExportSize;
  /** The underlying disposable image-export controller. */
  readonly imageExporter: GanttImageExporter;
}

/** A `Gantt`/`GanttApi` augmented with the image-export surface. */
export type GanttWithImageExport<T extends Model = Model> = GanttApi<T> &
  GanttImageExportApi;

/** Keys this feature defines on the host so teardown can remove exactly them. */
const GRAFTED_KEYS = [
  'exportPng',
  'exportImage',
  'exportImageDataUrl',
  'serializeImage',
  'measureImage',
  'imageExporter',
] as const;

/**
 * The image-export `GanttFeature`. Install once per Gantt; installing a second
 * instance is rejected by the widget's feature registry (same `name`).
 */
export class GanttImageExportFeature<T extends Model = Model>
  implements GanttFeature<T>
{
  readonly name = GANTT_IMAGE_EXPORT_FEATURE;

  private readonly config: GanttImageExportFeatureConfig;
  private exporter: GanttImageExporter | null = null;
  private host: (GanttApi<T> & Record<string, unknown>) | null = null;

  constructor(config: GanttImageExportFeatureConfig = {}) {
    this.config = config;
  }

  /** Whether the feature has been installed and not yet torn down. */
  get installed(): boolean {
    return this.exporter !== null;
  }

  /** The underlying controller, or `null` before `init` / after `destroy`. */
  get controller(): GanttImageExporter | null {
    return this.exporter;
  }

  init(api: GanttApi<T>): void {
    const root = api.el;
    const tokenHost = this.config.host ?? root;
    const exporter = new GanttImageExporter(root, tokenHost);
    this.exporter = exporter;

    const defaults = this.config.defaults ?? {};
    const merge = (opts?: GanttImageExportOptions): GanttImageExportOptions => ({
      ...defaults,
      ...opts,
    });

    const surface: GanttImageExportApi = {
      exportPng: (opts) => exporter.export({ ...merge(opts), type: 'image/png' }),
      exportImage: (opts) => exporter.export(merge(opts)),
      exportImageDataUrl: (opts) => exporter.exportDataUrl(merge(opts)),
      serializeImage: (opts) => exporter.serialize(merge(opts)),
      measureImage: (opts) => exporter.measure(opts),
      get imageExporter() {
        return exporter;
      },
    };

    // Graft the surface onto the live api/widget object additively. Use defined
    // own-properties (non-enumerable, configurable) so they read like real
    // methods, do not pollute enumeration/serialization, and can be removed
    // cleanly on teardown without disturbing anything the widget owns.
    const host = api as GanttApi<T> & Record<string, unknown>;
    this.host = host;
    const descriptors: PropertyDescriptorMap = {};
    for (const key of GRAFTED_KEYS) {
      const desc = Object.getOwnPropertyDescriptor(surface, key)!;
      descriptors[key] = { ...desc, configurable: true, enumerable: false };
    }
    Object.defineProperties(host, descriptors);

    // Belt-and-braces: also dispose if the host is destroyed first.
    api.track(() => this.destroy());
  }

  destroy(): void {
    const host = this.host;
    if (host) {
      for (const key of GRAFTED_KEYS) {
        // Only delete props this feature defined (configurable own-props).
        const desc = Object.getOwnPropertyDescriptor(host, key);
        if (desc && desc.configurable) delete host[key];
      }
      this.host = null;
    }
    this.exporter?.destroy();
    this.exporter = null;
  }
}

/** Factory mirroring the `createMultiBaselineCompare` / `createProgressLine` shape. */
export function createGanttImageExport<T extends Model = Model>(
  config: GanttImageExportFeatureConfig = {},
): GanttImageExportFeature<T> {
  return new GanttImageExportFeature<T>(config);
}

/**
 * Install the image-export feature onto a live Gantt and return the same
 * instance, narrowed to {@link GanttWithImageExport} so `gantt.exportPng()` is
 * statically reachable:
 *
 * ```ts
 * const gantt = installImageExport(new Gantt(el, { tasks }));
 * const blob = await gantt.exportPng({ pixelRatio: 2, download: 'plan.png' });
 * ```
 *
 * The passed object must expose `use(feature)` (every `Gantt` does); the feature
 * is registered so it is also reachable via `gantt.features.get('gantt-image-export')`.
 */
export function installImageExport<
  T extends Model = Model,
  G extends GanttApi<T> & { use(f: GanttFeature<T>): GanttFeature<T> } = GanttApi<T> & {
    use(f: GanttFeature<T>): GanttFeature<T>;
  },
>(gantt: G, config: GanttImageExportFeatureConfig = {}): G & GanttImageExportApi {
  gantt.use(new GanttImageExportFeature<T>(config));
  return gantt as G & GanttImageExportApi;
}
