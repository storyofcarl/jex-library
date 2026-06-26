/**
 * `@jects/gantt` — ICS export-preview stylesheet as a runtime-injectable string.
 *
 * Mirrors `ics-preview.css` verbatim so {@link renderIcsPreview} can inject the
 * token-pure styles into any document without a bundler/CSS pipeline (the
 * shipped build still gets them via the real `ics-preview.css` imported from
 * `styles.css`). Token-pure: only `--jects-*` tokens, in `@layer jects.components`.
 */
export const ICS_PREVIEW_STYLE = `@layer jects.components {
  .jects-gantt-ics-preview {
    display: block;
    color: oklch(var(--jects-foreground));
    font-family: var(--jects-font-family);
    font-size: var(--jects-font-size-sm);
  }

  .jects-gantt-ics-preview__summary {
    margin: 0 0 var(--jects-space-2) 0;
    color: oklch(var(--jects-muted-foreground));
  }

  .jects-gantt-ics-preview__table {
    inline-size: 100%;
    border-collapse: collapse;
    background: oklch(var(--jects-card));
    color: oklch(var(--jects-card-foreground));
    border: 1px solid oklch(var(--jects-border));
    border-radius: var(--jects-radius-md);
  }

  .jects-gantt-ics-preview__caption {
    caption-side: top;
    text-align: start;
    padding: var(--jects-space-2);
    font-weight: var(--jects-font-weight-semibold);
    color: oklch(var(--jects-foreground));
  }

  .jects-gantt-ics-preview__table th,
  .jects-gantt-ics-preview__table td {
    padding: var(--jects-space-1) var(--jects-space-2);
    text-align: start;
    border-block-end: 1px solid oklch(var(--jects-border));
  }

  .jects-gantt-ics-preview__table thead th {
    color: oklch(var(--jects-foreground));
    font-weight: var(--jects-font-weight-medium);
    background: oklch(var(--jects-muted));
  }

  .jects-gantt-ics-preview__name {
    font-weight: var(--jects-font-weight-medium);
  }

  .jects-gantt-ics-preview__row--milestone {
    background: oklch(var(--jects-accent) / 0.35);
  }

  .jects-gantt-ics-preview__milestone {
    color: oklch(var(--jects-primary));
  }
}
`;
