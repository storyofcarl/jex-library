/**
 * `@jects/gantt` — RESOURCE area barrel.
 *
 * The resource-management data layer (Bryntum/DHTMLX parity foundation): the
 * `Resource`/`Assignment` model types, the two stores, the `ResourceManager`
 * feature wiring them into the `ResourceApi`, and a small `ResourceAssignmentView`
 * widget. Everything here is ADDITIVE — installing the `ResourceManager` as a
 * `GanttFeature` (or via `GanttOptions.plugins`) wires resources into a Gantt
 * without any edit to the `Gantt` class.
 *
 * Importing this module pulls in the resource-view side-effect CSS and registers
 * the `resourceAssignmentView` widget with the factory.
 */

export type {
  ResourceType,
  ResourceModel,
  AssignmentModel,
  ResolvedAssignment,
  AssignmentStoreEvents,
  ResourceOptions,
  ResourceApi,
  ResourceEvents,
} from './resource-contract.js';

export {
  ResourceStore,
  normalizeResource,
  DEFAULT_RESOURCE_CAPACITY,
  DEFAULT_RESOURCE_TYPE,
  type ResourceStoreConfig,
} from './resource-store.js';

export {
  AssignmentStore,
  normalizeUnits,
  DEFAULT_ASSIGNMENT_UNITS,
  type AssignmentStoreConfig,
} from './assignment-store.js';

export {
  ResourceManager,
  createResourceManager,
  type ResourceManagerConfig,
} from './resource-manager.js';

export {
  ResourceAssignmentView,
  initials,
  type ResourceAssignmentViewConfig,
  type ResourceAssignmentViewEvents,
} from './resource-assignment-view.js';

/* ── Gantt integration (additive wiring) ──────────────────────────────────
   Folds the resource data layer + effort-driven engine onto a live `Gantt`
   without editing the Gantt class: an engine factory, the install helper, and
   the resource-aware option/surface types. See resource-integration.ts. */
export {
  installResourceManagement,
  createResourceGanttEngine,
  isResourceAwareEngine,
  withResources,
  type ResourceGanttOptions,
  type ResourceGantt,
  type ResourceGanttEvents,
  type InstallResourceOptions,
} from './resource-integration.js';

/* ── Resource VIEW (the visible resources pane) ───────────────────────────
   The on-screen resources pane: a grouped, flat list of resources (avatar/
   image, capacity, cost, allocation bar + over-allocation flag) with HTML5
   drag-to-assign onto task drop targets. Additive Widget + side-effect CSS;
   registers the `resourceView` widget with the factory. */
export {
  ResourceView,
  typeLabel,
  defaultFormatCost,
  RESOURCE_DND_MIME,
  type ResourceViewConfig,
  type ResourceViewEvents,
  type ResourceDropTargetOptions,
} from './resource-view.js';
