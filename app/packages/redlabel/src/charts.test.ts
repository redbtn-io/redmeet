import { describe, expect, it } from 'vitest';

import {
  CHART_TONES,
  chartHeatPalette,
  chartPalette,
  heatVar,
  seriesVar,
  toneVar,
  type ChartTone,
} from './charts';
import { CHART_HEAT_COUNT, CHART_SERIES_COUNT, COLOR_TOKEN_NAMES } from './tokens';

/**
 * The palettes are `var()` references and nothing else, which is the whole
 * reason a chart tracks a tenant accent with no re-render.
 */

describe('chartPalette', () => {
  it('is the categorical series as live var() references, in draw order', () => {
    expect(chartPalette()).toEqual([
      'var(--chart-1)',
      'var(--chart-2)',
      'var(--chart-3)',
      'var(--chart-4)',
      'var(--chart-5)',
      'var(--chart-6)',
      'var(--chart-7)',
      'var(--chart-8)',
    ]);
  });

  it('is seeded from redstyle’s own length, so a release that adds a slot grows the palette', () => {
    expect(chartPalette()).toHaveLength(CHART_SERIES_COUNT);
    expect(CHART_SERIES_COUNT).toBe(8);
  });

  it('takes no Brand, because a brand override of --chart-* applies at runtime', () => {
    expect(chartPalette.length).toBe(0);
    expect(chartHeatPalette.length).toBe(0);
  });
});

describe('chartHeatPalette', () => {
  it('is the seven-step ramp, index 0 being the empty bucket', () => {
    expect(chartHeatPalette()).toEqual([
      'var(--chart-heat-0)',
      'var(--chart-heat-1)',
      'var(--chart-heat-2)',
      'var(--chart-heat-3)',
      'var(--chart-heat-4)',
      'var(--chart-heat-5)',
      'var(--chart-heat-6)',
    ]);
    expect(CHART_HEAT_COUNT).toBe(7);
  });
});

describe('no hex, ever', () => {
  it('every emitted value is a var() reference', () => {
    const values = [
      ...chartPalette(),
      ...chartHeatPalette(),
      ...(Object.keys(CHART_TONES) as ChartTone[]).map(toneVar),
      seriesVar(0),
      heatVar(0.5),
      heatVar(null),
    ];
    for (const value of values) {
      expect(value).toMatch(/^var\(--[a-z0-9-]+\)$/);
      expect(value).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it('every tone names a real redstyle token', () => {
    for (const token of Object.values(CHART_TONES)) {
      expect(COLOR_TOKEN_NAMES as string[]).toContain(token);
    }
  });
});

describe('severity never comes from the categorical ramp', () => {
  it('maps to semantic tokens, and never to the accent', () => {
    expect(toneVar('critical')).toBe('var(--error)');
    expect(toneVar('high')).toBe('var(--warning)');
    expect(toneVar('medium')).toBe('var(--info)');
    expect(toneVar('low')).toBe('var(--text-muted)');
    expect(toneVar('info')).toBe('var(--text-disabled)');
    // The brand book reserves the accent for the decisive action.
    for (const severity of ['critical', 'high', 'medium', 'low', 'info'] as const) {
      expect(toneVar(severity)).not.toBe('var(--accent)');
    }
  });
});

describe('seriesVar and heatVar are total', () => {
  it('a series index wraps rather than reading past the end', () => {
    expect(seriesVar(0)).toBe('var(--chart-1)');
    expect(seriesVar(7)).toBe('var(--chart-8)');
    expect(seriesVar(8)).toBe('var(--chart-1)');
    expect(seriesVar(-1)).toBe('var(--chart-8)');
    expect(seriesVar(1.9)).toBe('var(--chart-2)');
  });

  it('step 0 is reserved for no data, so a real zero still reads as data', () => {
    expect(heatVar(null)).toBe('var(--chart-heat-0)');
    expect(heatVar(Number.NaN)).toBe('var(--chart-heat-0)');
    expect(heatVar(0)).toBe('var(--chart-heat-1)');
    expect(heatVar(1)).toBe('var(--chart-heat-6)');
    expect(heatVar(2)).toBe('var(--chart-heat-6)');
    expect(heatVar(-1)).toBe('var(--chart-heat-1)');
  });

  it('the ramp is monotonic across the range', () => {
    const steps = [0, 0.2, 0.4, 0.6, 0.8, 1].map((value) => heatVar(value));
    const indexes = steps.map((step) => Number(/heat-(\d)/.exec(step)?.[1]));
    for (let i = 1; i < indexes.length; i += 1) {
      expect(indexes[i]).toBeGreaterThanOrEqual(indexes[i - 1] as number);
    }
  });
});
