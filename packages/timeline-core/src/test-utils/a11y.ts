/**
 * Accessibility test helper for the Vitest browser (Chromium) environment.
 *
 * Runs axe-core against a mounted element and throws a readable error if any
 * violation with impact `serious` or `critical` is found. Violations with
 * impact `moderate` or `minor` (or `null`) are intentionally ignored, matching
 * the Quality Gate Q2 bar of "zero serious/critical violations".
 *
 * Usage (inside a `*.browser.test.ts`):
 *
 *   import { expectNoA11yViolations } from '../test-utils/a11y.js';
 *   await expectNoA11yViolations(host);
 */
import axe from 'axe-core';

type BlockingImpact = 'serious' | 'critical';

const BLOCKING_IMPACTS: readonly BlockingImpact[] = ['serious', 'critical'];

function isBlocking(impact: axe.ImpactValue | undefined | null): boolean {
  return impact != null && (BLOCKING_IMPACTS as readonly string[]).includes(impact);
}

function formatViolations(violations: axe.Result[]): string {
  const lines: string[] = [
    `Found ${violations.length} serious/critical accessibility violation(s):`,
  ];
  for (const v of violations) {
    lines.push('');
    lines.push(`  [${v.impact ?? 'unknown'}] ${v.id}: ${v.help}`);
    lines.push(`    ${v.helpUrl}`);
    for (const node of v.nodes) {
      const target = node.target.join(', ');
      const summary = (node.failureSummary ?? '').replace(/\n/g, '\n      ');
      lines.push(`    - ${target}`);
      if (summary) lines.push(`      ${summary}`);
    }
  }
  return lines.join('\n');
}

/**
 * Run axe-core on `el` and throw if any serious/critical violations exist.
 *
 * @param el A mounted HTMLElement (must be attached to the document so the
 *           browser computes layout, roles, and accessible names correctly).
 */
export async function expectNoA11yViolations(el: HTMLElement): Promise<void> {
  const results = await axe.run(el);
  const blocking = results.violations.filter((v) => isBlocking(v.impact));
  if (blocking.length > 0) {
    throw new Error(formatViolations(blocking));
  }
}
