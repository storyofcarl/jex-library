/**
 * `@jects/gantt` — IO barrel: MS Project (MSPDI) import/export, publicly.
 *
 * Re-exports the orphaned `io/msproject.ts` codec (XML reader/writer, value
 * codecs, binary-`.mpp` detection) together with the {@link fromMsProject} /
 * {@link toMsProject} glue that bridges a {@link MsProjectBundle} and a live
 * `Gantt`. Import from here (or, once the package barrel re-exports this module,
 * from `@jects/gantt`) to round-trip an MS Project file through the public API:
 *
 * ```ts
 * import { importMsProjectAsOptions, ganttToMsProjectXml } from '@jects/gantt';
 *
 * const { options, warnings } = importMsProjectAsOptions(xmlText);
 * const gantt = new Gantt(host, options);
 * // …edit…
 * const xml = ganttToMsProjectXml(gantt); // opens in MS Project
 * ```
 */

/* ── MSPDI codec (the data layer — pure, framework-free) ─────────────────── */
export {
  importMsProject,
  importMsProjectFile,
  exportMsProject,
  isBinaryMpp,
  // value codecs (useful for custom MSPDI mapping / tests)
  parseMsDate,
  formatMsDate,
  parseMsDuration,
  formatMsDuration,
  // tiny tolerant XML reader/writer + helpers
  parseXml,
  decodeXmlText,
  escapeXml,
  child,
  children,
  childText,
} from './msproject.js';
export type {
  MsProjectBundle,
  MsProjectImportResult,
  MsProjectImportWarning,
  MsProjectImportOptions,
  MsProjectExportOptions,
  XmlNode,
} from './msproject.js';

/* ── Gantt ⇄ bundle glue (the wiring layer) ──────────────────────────────── */
export {
  fromMsProject,
  toMsProject,
  importMsProjectAsOptions,
  ganttToMsProjectXml,
  roundTripMsProject,
} from './gantt-bridge.js';
export type {
  FromMsProjectOptions,
  ToMsProjectOptions,
  LiveGantt,
} from './gantt-bridge.js';

/* ── Native .mpp binary codec (OLE2/CFB compound file) ───────────────────────
   Binary MS Project `.mpp` read/write reusing the MSPDI XML payload — same
   epoch-ms/working-ms contract as the XML codec. The bridge exposes
   `importMppAsOptions` → `new Gantt(...)` → `ganttToMpp(gantt)`. */
export {
  exportMpp,
  importMpp,
  isMpp,
  roundTripMpp,
  listMppStreams,
  readCfb,
  writeCfb,
  isCfb,
  MPP_XML_STREAM,
  MPP_MARKER_STREAM,
  MPP_CODEC_VERSION,
} from './mpp-codec.js';
export type {
  MppExportOptions,
  MppImportOptions,
  MppImportResult,
  CfbStream,
  CfbContainer,
} from './mpp-codec.js';
export { importMppAsOptions, ganttToMpp, roundTripGanttMpp } from './mpp-bridge.js';
export type { ImportMppAsOptionsResult } from './mpp-bridge.js';
