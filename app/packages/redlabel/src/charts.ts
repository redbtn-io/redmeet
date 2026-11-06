/**
 * The chart palettes, as live `var()` references.
 *
 * They live in `.` rather than in `./ui` because the PDF renderer, the OG image
 * renderer and the export pipeline need the same list as the SVG components, and
 * `.` is the entry a non-React consumer imports.
 *
 * **Neither function takes a `Brand`, and that is the design.** They are seeded
 * from the LENGTH of redstyle's `chartSeries` and `chartHeat` and carry no brand
 * input at all, so a chart tracks the live theme and any brand override of
 * `--chart-*` at runtime with no re-render and no per-brand palette to keep in
 * step. `chartSeriesHex` and `chartHeatHex` are never read, here or anywhere:
 * they freeze one theme's hex into the markup, which is redstyle leak 5.
 *
 * **Severity never comes from this ramp.** It maps to semantic tokens: critical
 * `--error`, high `--warning`, medium `--info`, low and info `--text-muted`, and
 * never `--accent`, which the brand book reserves for the decisive action. The
 * categorical slots are for IDENTITY (per project, per engine, per language).
 * Every severity mark also carries a label or a shape, so it never depends on
 * colour alone.
 */
import {
  CHART_HEAT_COUNT,
  CHART_SERIES_COUNT,
  tokenVar,
  type ColorTokenName,
} from './tokens';

/** The categorical series, in draw order. `['var(--chart-1)', ... 'var(--chart-8)']`. */
export function chartPalette(): string[] {
  return Array.from({ length: CHART_SERIES_COUNT }, (_unused, index) =>
    tokenVar(`chart-${index + 1}` as ColorTokenName),
  );
}

/** The sequential heat ramp, index 0 being the empty bucket. Seven steps. */
export function chartHeatPalette(): string[] {
  return Array.from({ length: CHART_HEAT_COUNT }, (_unused, index) =>
    tokenVar(`chart-heat-${index}` as ColorTokenName),
  );
}

/**
 * The semantic tones a chart segment may carry, and the token each resolves to.
 *
 * A caller names a MEANING and gets a token; it never names a colour. That is
 * what keeps the one severity-to-colour mapping in the app (`SeverityMark`) and
 * this one list of tones the only two places a status becomes a colour.
 */
export const CHART_TONES = {
  critical: 'error',
  high: 'warning',
  medium: 'info',
  low: 'text-muted',
  info: 'text-disabled',
  success: 'success',
  neutral: 'text-muted',
  accent: 'accent',
} as const satisfies Readonly<Record<string, ColorTokenName>>;

export type ChartTone = keyof typeof CHART_TONES;

/** `var(--error)` for `'critical'`. The only bridge from a tone to a paintable value. */
export function toneVar(tone: ChartTone): string {
  return tokenVar(CHART_TONES[tone]);
}

/** Slot `n` of the categorical ramp, wrapping, so a caller never indexes out of range. */
export function seriesVar(index: number): string {
  const palette = chartPalette();
  const slot = ((Math.trunc(index) % palette.length) + palette.length) % palette.length;
  return palette[slot] as string;
}

/**
 * The heat step for a value in `[0, 1]`, or for `null`, which is the empty
 * bucket. Step 0 is reserved for "no data", so a real zero still reads as data.
 */
export function heatVar(fraction: number | null): string {
  const ramp = chartHeatPalette();
  if (fraction === null || !Number.isFinite(fraction)) return ramp[0] as string;
  const steps = ramp.length - 1;
  const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  const step = Math.min(steps, Math.max(1, Math.ceil(clamped * steps)));
  return ramp[step] as string;
}
