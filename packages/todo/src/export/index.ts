/**
 * `@jects/todo/export` — the package's task import/export helpers as a standalone,
 * tree-shakeable entry point.
 *
 * These are the pure, DOM-free serializers/parsers that round-trip a task tree to
 * and from CSV / JSON (plus the shared `flattenTasks` they build on). They live in
 * `../todo-utils.ts`, which imports nothing but the type-only `../contract.ts` — so
 * a consumer that only needs export/import (e.g. a server-side or CLI exporter)
 * can pull this area WITHOUT dragging in the `TodoList` widget, `@jects/widgets`,
 * or the rest of the package hub.
 *
 * ES-only subpath (UMD cannot express multiple entries); the main `.` entry keeps
 * its ESM + UMD builds and stays byte-intact.
 */

export {
  flattenTasks,
  tasksToCsv,
  tasksToJson,
  tasksFromJson,
  tasksFromCsv,
} from '../todo-utils.js';

export type {
  TodoTask,
  TodoStatus,
  TodoExportFormat,
  TodoExportOptions,
  TodoImportFormat,
  TodoImportOptions,
} from '../contract.js';
