/**
 * Scheduler export — public typed config + result + event surface.
 */

import type { ExportPalette } from './paint-canvas.js';

/** Named paper sizes in PDF points (1pt = 1/72"), portrait. */
export const PAPER_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  a3: { width: 841.89, height: 1190.55 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
  tabloid: { width: 792, height: 1224 },
} as const;

export type PaperSize = keyof typeof PAPER_SIZES;
export type PageOrientation = 'portrait' | 'landscape';

/** Options shared by PNG + PDF export. */
export interface ExportCommonConfig {
  /** Device pixel ratio for the raster (higher = sharper). Default 2. */
  scale?: number;
  /** Override the resolved theme palette (else read from the live theme). */
  palette?: Partial<ExportPalette>;
  /** Document/file title. Defaults to the scheduler's configured title. */
  title?: string;
  /** File name (without extension). Default `'schedule'`. */
  fileName?: string;
}

/** PNG export options. */
export interface PngExportConfig extends ExportCommonConfig {
  /**
   * When true, the WHOLE schedule is rendered into one tall/wide PNG. When
   * false (default), only the currently exportable content is rendered at full
   * size — which for PNG is the same single image (PNG is inherently one page).
   */
  fullSchedule?: boolean;
  /** Background — `'theme'` (default) paints the theme background; `'transparent'` leaves it clear. */
  background?: 'theme' | 'transparent';
}

/** PDF export options. */
export interface PdfExportConfig extends ExportCommonConfig {
  /** Paper size. Default `'a4'`. */
  paper?: PaperSize;
  /** Page orientation. Default `'landscape'` (schedules are wide). */
  orientation?: PageOrientation;
  /** Page margin in PDF points. Default 24. */
  margin?: number;
}

/** A produced export artifact. */
export interface ExportResult {
  /** MIME type (`image/png` / `application/pdf`). */
  type: string;
  /** Suggested file name (with extension). */
  fileName: string;
  /** Raw bytes. */
  bytes: Uint8Array;
  /** A Blob when the platform supports it (browser). */
  blob?: Blob;
  /** Number of output pages (1 for PNG). */
  pageCount: number;
  /** A `data:` URL for the artifact (convenience for tests / previews). */
  dataUrl(): string;
}

/** Events emitted around an export (vetoable `beforeExport`). */
export interface SchedulerExportEvents {
  /** Vetoable: an export is about to run. Return false to cancel. */
  beforeExport: { format: 'pdf' | 'png'; config: ExportCommonConfig };
  /** An export completed. */
  export: { format: 'pdf' | 'png'; result: ExportResult };
}
