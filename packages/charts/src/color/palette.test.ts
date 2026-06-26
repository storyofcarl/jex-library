import { describe, it, expect } from 'vitest';
import {
  RAMP_SIZE,
  RAMP_TOKENS,
  seriesColor,
  rampColor,
  tokenColor,
  resolveSeriesColor,
} from './palette.js';

describe('house ramp tokens', () => {
  it('has eight stops named --jects-data-1..8', () => {
    expect(RAMP_SIZE).toBe(8);
    expect(RAMP_TOKENS[0]).toBe('--jects-data-1');
    expect(RAMP_TOKENS[7]).toBe('--jects-data-8');
  });

  it('seriesColor references a ramp token via oklch(var(...))', () => {
    expect(seriesColor(0)).toBe('oklch(var(--jects-data-1))');
    expect(seriesColor(2)).toBe('oklch(var(--jects-data-3))');
  });

  it('cycles modulo the ramp size', () => {
    expect(seriesColor(8)).toBe(seriesColor(0));
    expect(seriesColor(9)).toBe(seriesColor(1));
  });

  it('handles negative indices safely', () => {
    expect(seriesColor(-1)).toBe('oklch(var(--jects-data-8))');
  });

  it('applies alpha via the slash form', () => {
    expect(seriesColor(0, 0.5)).toBe('oklch(var(--jects-data-1) / 0.5)');
  });

  it('rampColor uses 1-based stops', () => {
    expect(rampColor(1)).toBe(seriesColor(0));
  });

  it('tokenColor wraps arbitrary semantic tokens', () => {
    expect(tokenColor('foreground')).toBe('oklch(var(--jects-foreground))');
    expect(tokenColor('--jects-border')).toBe('oklch(var(--jects-border))');
  });

  it('resolveSeriesColor falls back to the live token in jsdom', () => {
    const el = document.createElement('div');
    // jsdom doesn't resolve custom properties; expect the live reference back.
    expect(resolveSeriesColor(0, el)).toBe('oklch(var(--jects-data-1))');
  });

  it('NEVER emits a hardcoded color literal', () => {
    for (let i = 0; i < 16; i++) {
      const c = seriesColor(i);
      expect(c).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(c).not.toMatch(/rgb|hsl/);
      expect(c).toContain('var(--jects-');
    }
  });
});
