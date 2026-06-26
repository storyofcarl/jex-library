/**
 * `@jects/gantt` — ICS export FEATURE (additive `GanttFeature` + installer).
 *
 * Wires the DOM-free {@link tasksToIcs} writer onto a live `Gantt` without editing
 * the widget class. Installing the feature (via `gantt.use(new
 * GanttIcsExportFeature())`, `GanttOptions.plugins`, or {@link installIcsExport})
 * adds an `exportIcs()` method to the Gantt's public surface that:
 *
 *   1. Reads the Gantt's task tree THROUGH the `GanttApi` (`timeline.rows` +
 *      `getChildren`) — never reaching into the widget's private store.
 *   2. Resolves each task's assigned resources into `ATTENDEE` lines THROUGH the
 *      `GanttApi.resources` surface (when a resource layer is active), so the
 *      exported VEVENTs carry real people/equipment as attendees + organizer.
 *   3. Serializes to a `VCALENDAR` string via {@link tasksToIcs}.
 *   4. Optionally triggers a browser download (`exportIcs({ download: true })`)
 *      or returns the raw string (`exportIcs()` / `getIcsString()`).
 *
 * The feature is contract-pure: it only touches `GanttApi` (`timeline`,
 * `getChildren`, `getTask`, `resources`, `track`) and the DOM-free writer. It owns
 * no styling (an ICS file has no visual surface), so there is no CSS. The integrator
 * exposes the resulting `exportIcs`/`getIcsString` on the public Gantt instance —
 * see the wire notes.
 *
 * All times are epoch milliseconds (UTC).
 */

import type { Model, RecordId } from '@jects/core';
import type { GanttApi, GanttFeature, TaskModel } from '../contract.js';
import type {
  ResourceApi,
  ResourceModel,
  ResourceType,
} from '../resource/resource-contract.js';
import type { TaskTreeSource } from './serialize.js';
import {
  tasksToIcs,
  ICS_MIME_TYPE,
  ICS_FILE_EXTENSION,
  type IcsAttendee,
  type IcsExportOptions,
} from './ics.js';

/** Registry key the feature installs under (`feature.name`). */
export const GANTT_ICS_EXPORT_FEATURE = 'icsExport';

/* ═══════════════════════════════════════════════════════════════════════════
   1. FEATURE CONFIG / API SHAPE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Per-call options for `exportIcs()`. Extends the writer's
 * {@link IcsExportOptions} with download/UI knobs handled by the feature.
 */
export interface GanttExportIcsOptions<T extends Model = Model>
  extends IcsExportOptions<T> {
  /**
   * When `true`, trigger a browser download of the ICS file (no-op under jsdom,
   * where the string is still returned). Default `false`.
   */
  download?: boolean;
  /** Download file name (without extension). Default `'gantt'`. */
  fileName?: string;
}

/** Construction config for {@link GanttIcsExportFeature} (default per-export options). */
export interface GanttIcsExportFeatureConfig<T extends Model = Model> {
  /** Default options merged under every `exportIcs()` call's own options. */
  defaults?: GanttExportIcsOptions<T>;
}

/** The methods the feature grafts onto the Gantt's public surface. */
export interface GanttIcsExportApi<T extends Model = Model> {
  /**
   * Serialize the current schedule to an iCalendar `VCALENDAR` string. When
   * `options.download` is set, also triggers a browser file download. Returns the
   * ICS string in all environments.
   */
  exportIcs(options?: GanttExportIcsOptions<T>): string;
  /** Serialize to an ICS string without any download side-effect. */
  getIcsString(options?: IcsExportOptions<T>): string;
}

/** A `Gantt` (api) augmented with the ICS-export methods this feature adds. */
export type GanttWithIcsExport<T extends Model = Model> = GanttApi<T> &
  GanttIcsExportApi<T>;

/* ═══════════════════════════════════════════════════════════════════════════
   2. FEATURE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The additive ICS-export feature. Installs `exportIcs()`/`getIcsString()` onto
 * the host `GanttApi` and releases them on `destroy()`.
 */
export class GanttIcsExportFeature<T extends Model = Model>
  implements GanttFeature<T>, GanttIcsExportApi<T>
{
  readonly name = GANTT_ICS_EXPORT_FEATURE;

  private api: GanttApi<T> | undefined;
  private readonly defaults: GanttExportIcsOptions<T>;

  constructor(config: GanttIcsExportFeatureConfig<T> = {}) {
    this.defaults = config.defaults ?? {};
  }

  init(api: GanttApi<T>): void {
    this.api = api;
    // Graft the public methods onto the host so `gantt.exportIcs(...)` works.
    const host = api as GanttWithIcsExport<T>;
    host.exportIcs = (options?: GanttExportIcsOptions<T>): string =>
      this.exportIcs(options);
    host.getIcsString = (options?: IcsExportOptions<T>): string =>
      this.getIcsString(options);

    api.track(() => this.destroy());
  }

  destroy(): void {
    if (this.api) {
      const host = this.api as Partial<GanttWithIcsExport<T>>;
      delete host.exportIcs;
      delete host.getIcsString;
      this.api = undefined;
    }
  }

  /** {@inheritDoc GanttIcsExportApi.getIcsString} */
  getIcsString(options: IcsExportOptions<T> = {}): string {
    const api = this.requireApi();
    const merged = this.mergeOptions(options);
    const source = ganttTreeSource(api);
    const resolvers = resourceAttendeeResolvers<T>(api, merged);
    return tasksToIcs<T>(source, { ...merged, ...resolvers });
  }

  /** {@inheritDoc GanttIcsExportApi.exportIcs} */
  exportIcs(options: GanttExportIcsOptions<T> = {}): string {
    const merged = this.mergeOptions(options);
    const ics = this.getIcsString(merged);
    if (merged.download) {
      downloadIcs(ics, (merged.fileName ?? 'gantt') + ICS_FILE_EXTENSION);
    }
    return ics;
  }

  private mergeOptions(options: GanttExportIcsOptions<T>): GanttExportIcsOptions<T> {
    return { ...this.defaults, ...options };
  }

  private requireApi(): GanttApi<T> {
    if (!this.api) throw new Error('GanttIcsExportFeature is not installed');
    return this.api;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. GANTT-API → TREE SOURCE / RESOURCE RESOLVERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Flatten a `GanttOptions.tasks` value (TreeStore / nested array / flat array)
 *  into the FULL depth-first task list. A `@jects/core` `TreeStore` exposes
 *  `getItems()` (every node, ignoring collapse/filter); a nested-children array is
 *  walked recursively; a flat `parentId` array is returned as-is. */
function flattenConfigTasks<T extends Model>(
  tasksConfig: unknown,
): Array<TaskModel<T> & { children?: TaskModel<T>[] }> {
  if (
    tasksConfig &&
    typeof tasksConfig === 'object' &&
    typeof (tasksConfig as { getItems?: unknown }).getItems === 'function'
  ) {
    return (tasksConfig as { getItems(): Array<TaskModel<T>> })
      .getItems()
      .slice() as Array<TaskModel<T> & { children?: TaskModel<T>[] }>;
  }
  if (Array.isArray(tasksConfig)) {
    const out: Array<TaskModel<T> & { children?: TaskModel<T>[] }> = [];
    const walk = (
      nodes: ReadonlyArray<TaskModel<T> & { children?: TaskModel<T>[] }>,
    ): void => {
      for (const n of nodes) {
        out.push(n);
        const kids = n.children;
        if (Array.isArray(kids) && kids.length > 0) walk(kids);
      }
    };
    walk(tasksConfig as Array<TaskModel<T> & { children?: TaskModel<T>[] }>);
    return out;
  }
  return [];
}

/**
 * Build a {@link TaskTreeSource} over a live Gantt.
 *
 * The authoritative source is the resolved `tasks` config (`getConfig().tasks`) —
 * the FULL project store, identical to what the CSV / XLSX / MS-Project exporters
 * read — so the ICS export always serializes every task regardless of
 * scroll/render state, collapsed summaries, virtualization, or an active filter.
 * Each node is re-resolved through `api.getTask` so the events carry the CURRENT
 * scheduled spans rather than the authored ones.
 *
 * It falls back to reconstructing the tree from `timeline.rows` only when no task
 * config is reachable on the host (e.g. a bare `GanttApi` shim). Pure read — no DOM.
 */
export function ganttTreeSource<T extends Model = Model>(
  api: GanttApi<T>,
): TaskTreeSource<T> {
  // Re-resolve a node to its live engine task (keeps authored fields if dropped).
  const live = (
    t: TaskModel<T> & { children?: TaskModel<T>[] },
  ): TaskModel<T> & { children?: TaskModel<T>[] } =>
    ({ ...(api.getTask(t.id) ?? t) }) as TaskModel<T> & {
      children?: TaskModel<T>[];
    };
  const getChildren = (
    node: (TaskModel<T> & { children?: TaskModel<T>[] }) | RecordId,
  ): ReadonlyArray<TaskModel<T> & { children?: TaskModel<T>[] }> => {
    const id = typeof node === 'object' ? node.id : node;
    return (
      api.getChildren(id) as ReadonlyArray<
        TaskModel<T> & { children?: TaskModel<T>[] }
      >
    ).map(live);
  };

  // Primary path: the authoritative full task store from the resolved config.
  const tasksConfig = (
    api as unknown as { getConfig?: () => { tasks?: unknown } }
  ).getConfig?.().tasks;
  const flat = flattenConfigTasks<T>(tasksConfig);
  if (flat.length > 0) {
    // Roots are the nodes that are nobody's child (robust to missing parentId on
    // nested-array children — discover child ids via the live tree).
    const childIds = new Set<RecordId>();
    for (const t of flat) for (const c of getChildren(t.id)) childIds.add(c.id);
    const roots = flat.filter((t) => !childIds.has(t.id)).map(live);
    return { items: roots, getChildren };
  }

  // Fallback: reconstruct from the timeline rows (collapsed children recovered via
  // `getChildren`). Used only when the host exposes no task config.
  const rows = api.timeline.rows;
  const all: Array<TaskModel<T> & { children?: TaskModel<T>[] }> = [];
  for (let i = 0; i < rows.count; i++) {
    const row = rows.rowAt(i);
    if (!row) continue;
    all.push(row.record as unknown as TaskModel<T> & { children?: TaskModel<T>[] });
  }
  const ids = new Set(all.map((t) => t.id));
  // Roots: tasks with no parent, or whose parent is outside the row set.
  const roots = all.filter(
    (t) => t.parentId == null || !ids.has(t.parentId as RecordId),
  );
  return { items: roots, getChildren };
}

/** Map a resource type to the ICS `CUTYPE` parameter. */
function cutypeFor(type: ResourceType | undefined): NonNullable<IcsAttendee['cutype']> {
  switch (type) {
    case 'equipment':
    case 'material':
      return 'RESOURCE';
    case 'cost':
      return 'UNKNOWN';
    case 'work':
    default:
      return 'INDIVIDUAL';
  }
}

/**
 * Read an optional email off a resource model (consumers may carry `email` on the
 * resource or in its `data` bag). Returns `undefined` when none is present.
 */
function resourceEmail<R extends Model>(resource: ResourceModel<R>): string | undefined {
  const direct = (resource as { email?: unknown }).email;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const fromData = (resource.data as { email?: unknown } | undefined)?.email;
  if (typeof fromData === 'string' && fromData.length > 0) return fromData;
  return undefined;
}

/** Convert a resolved resource into an ICS attendee. */
function resourceToAttendee<R extends Model>(
  resource: ResourceModel<R>,
): IcsAttendee {
  const att: IcsAttendee = { id: resource.id };
  if (resource.name != null && resource.name !== '') att.name = resource.name;
  const email = resourceEmail(resource);
  if (email) att.email = email;
  att.cutype = cutypeFor(resource.type);
  return att;
}

/**
 * Build the attendee resolver from the Gantt's resource layer (when present). When
 * the consumer already supplied an `attendeesOf` resolver in the options, that one
 * wins (returns an empty object so the option passes through unchanged).
 */
export function resourceAttendeeResolvers<T extends Model = Model>(
  api: GanttApi<T>,
  options: IcsExportOptions<T>,
): Pick<IcsExportOptions<T>, 'attendeesOf'> {
  if (options.attendeesOf) return {};
  const resources: ResourceApi<T> | undefined = api.resources;
  if (!resources) return {};
  return {
    attendeesOf: (task: TaskModel<T>): ReadonlyArray<IcsAttendee> => {
      const resolved = resources.getAssignmentsFor(task.id);
      const out: IcsAttendee[] = [];
      for (const a of resolved) {
        if (a.resource) out.push(resourceToAttendee(a.resource));
      }
      return out;
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. DOWNLOAD HELPER (browser; no-op under jsdom)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Trigger a browser download of an ICS string. Returns `true` if the download was
 * initiated, `false` in a host without DOM/`URL.createObjectURL` (jsdom), so the
 * caller can fall back to the returned string.
 */
export function downloadIcs(ics: string, fileName: string): boolean {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return false;
  }
  try {
    const blob = new Blob([ics], { type: ICS_MIME_TYPE });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the click has consumed the URL. Guard the call
    // (some hosts/tests stub only `createObjectURL`) so a missing revoke never
    // throws asynchronously after the export resolved.
    setTimeout(() => {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    }, 0);
    return true;
  } catch {
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. FACTORY / INSTALLER
   ═══════════════════════════════════════════════════════════════════════════ */

/** Construct a {@link GanttIcsExportFeature}. */
export function createGanttIcsExport<T extends Model = Model>(
  config?: GanttIcsExportFeatureConfig<T>,
): GanttIcsExportFeature<T> {
  return new GanttIcsExportFeature<T>(config);
}

/**
 * Install ICS export onto a live Gantt and return the augmented surface. Adopts an
 * already-installed feature instead of double-installing.
 *
 * @example
 *   const g = installIcsExport(gantt);
 *   const ics = g.exportIcs({ download: true, fileName: 'project' });
 */
export function installIcsExport<T extends Model = Model>(
  api: GanttApi<T>,
  config?: GanttIcsExportFeatureConfig<T>,
): GanttWithIcsExport<T> {
  const existing = api.features.get(GANTT_ICS_EXPORT_FEATURE);
  if (existing instanceof GanttIcsExportFeature) {
    return api as GanttWithIcsExport<T>;
  }
  api.use(new GanttIcsExportFeature<T>(config));
  return api as GanttWithIcsExport<T>;
}
