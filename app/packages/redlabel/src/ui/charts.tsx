import type React from 'react';

import { heatVar, seriesVar, toneVar, type ChartTone } from '../charts';

/**
 * Four charts, inline SVG, zero dependencies.
 *
 * **V:** neither `redoffice` nor `redboard` declares recharts, chart.js, d3,
 * victory, visx or nivo on `origin/main`. There is no house chart library to be
 * consistent with, so adding one would make redLabel the heaviest dependency in a
 * product whose bundle budget is a findings table on a phone. All four are under
 * 200 lines of SVG. If a real charting need appears (a zoomable time series,
 * brushing), the dependency goes behind `./ui/charts`, where it is already
 * isolated.
 *
 * **Every colour is a `var()` from `src/charts.ts`, never a hex and never
 * `chartSeriesHex`.** A `var()` tracks the live theme and any brand override of
 * `--chart-*` at runtime; a resolved hex freezes one brand's palette into the
 * markup, which is redstyle leak 5.
 *
 * Accessibility, from ui.md 2.3, and the middle rule is the subtle one:
 *
 * - `role="img"` plus an `aria-label` that states the value in words.
 * - **No per-segment `<title>`.** An `aria-label` on an `<svg role="img">`
 *   suppresses child `<title>` elements, so a title is never the text channel.
 *   The text channel is the label, and the caller's table twin.
 * - Colour is never the only channel: every component takes and renders a label,
 *   and `StackedBar` and `HeatStrip` both take semantic tones rather than
 *   positions in a ramp.
 *
 * All four are SERVER components with no directive. They are pure functions of
 * their props, and ui.md renders them inside server-rendered cards.
 */

/* --------------------------------------------------------------- Donut -- */

export interface DonutProps {
  /** 0 to 1. Out of range is clamped, because a posture grade cannot be 140%. */
  value: number;
  /** The text in the middle. A grade letter, a percentage, a count. */
  label?: React.ReactNode;
  /** What a screen reader hears. Defaults to the rounded percentage. */
  ariaLabel?: string;
  size?: number;
  thickness?: number;
  /** The semantic meaning of the arc. Never a slot in the categorical ramp. */
  tone?: ChartTone;
  className?: string;
}

export function Donut({
  value,
  label,
  ariaLabel,
  size = 96,
  thickness = 8,
  tone = 'accent',
  className,
}: DonutProps): React.JSX.Element {
  const fraction = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  return (
    <span
      className={['relative inline-flex items-center justify-center', className]
        .filter(Boolean)
        .join(' ')}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel ?? `${Math.round(fraction * 100)} percent`}
        focusable="false"
      >
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke="var(--bg-tertiary)"
          strokeWidth={thickness}
        />
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={toneVar(tone)}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          transform={`rotate(-90 ${centre} ${centre})`}
        />
      </svg>
      {label !== undefined ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums text-text-primary"
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------ Sparkline -- */

export interface SparklineProps {
  points: number[];
  ariaLabel: string;
  width?: number;
  height?: number;
  tone?: ChartTone;
  className?: string;
}

export function Sparkline({
  points,
  ariaLabel,
  width = 96,
  height = 24,
  tone = 'accent',
  className,
}: SparklineProps): React.JSX.Element {
  const values = points.filter((point) => Number.isFinite(point));
  const stroke = toneVar(tone);

  // One point is not a trend and no points is not a chart. Both render the
  // frame, so a card does not reflow when data arrives.
  if (values.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        focusable="false"
        className={className}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--bg-tertiary)"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const step = width / (values.length - 1);
  const path = values
    .map((point, index) => {
      const x = index * step;
      const y = height - ((point - low) / span) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      focusable="false"
      preserveAspectRatio="none"
      className={className}
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ----------------------------------------------------------- StackedBar -- */

export interface StackedBarSegment {
  value: number;
  /** A MEANING, not a colour. `critical`, `high`, `medium`, `low`, `info`. */
  tone: ChartTone;
  /** The text channel for this segment, used in the composed aria-label. */
  label?: string;
}

export interface StackedBarProps {
  segments: StackedBarSegment[];
  ariaLabel?: string;
  height?: number;
  className?: string;
}

export function StackedBar({
  segments,
  ariaLabel,
  height = 8,
  className,
}: StackedBarProps): React.JSX.Element {
  const usable = segments.filter((segment) => Number.isFinite(segment.value) && segment.value > 0);
  const total = usable.reduce((sum, segment) => sum + segment.value, 0);
  const described =
    ariaLabel ??
    (total === 0
      ? 'no data'
      : usable.map((segment) => `${segment.label ?? segment.tone} ${segment.value}`).join(', '));

  let offset = 0;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 100 ${height}`}
      role="img"
      aria-label={described}
      focusable="false"
      preserveAspectRatio="none"
      className={['block overflow-hidden rounded-full', className].filter(Boolean).join(' ')}
    >
      <rect x={0} y={0} width={100} height={height} fill="var(--bg-tertiary)" />
      {total > 0
        ? usable.map((segment, index) => {
            const span = (segment.value / total) * 100;
            const x = offset;
            offset += span;
            return (
              <rect
                key={`${segment.tone}-${index}`}
                x={x}
                y={0}
                width={span}
                height={height}
                fill={toneVar(segment.tone)}
              />
            );
          })
        : null}
    </svg>
  );
}

/* ------------------------------------------------------------ HeatStrip -- */

export interface HeatStripProps {
  /** A fraction in `[0, 1]` per bucket, or `null` for a bucket with no data. */
  buckets: Array<number | null>;
  ariaLabel: string;
  cell?: number;
  gap?: number;
  className?: string;
}

export function HeatStrip({
  buckets,
  ariaLabel,
  cell = 10,
  gap = 2,
  className,
}: HeatStripProps): React.JSX.Element {
  const width = buckets.length * cell + Math.max(0, buckets.length - 1) * gap;
  return (
    <svg
      width={width}
      height={cell}
      viewBox={`0 0 ${width} ${cell}`}
      role="img"
      aria-label={ariaLabel}
      focusable="false"
      className={className}
    >
      {buckets.map((bucket, index) => (
        <rect
          key={index}
          x={index * (cell + gap)}
          y={0}
          width={cell}
          height={cell}
          rx={2}
          fill={heatVar(bucket)}
        />
      ))}
    </svg>
  );
}

/* -------------------------------------------------------------- Legend -- */

/**
 * The categorical ramp's one legitimate consumer inside this package: a legend
 * for an IDENTITY series (per project, per engine, per language). Severity, gate
 * outcome and engine status are semantic and use tones instead.
 */
export interface SeriesSwatchProps {
  index: number;
  className?: string;
}

export function SeriesSwatch({ index, className }: SeriesSwatchProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={['inline-block size-2 rounded-full', className].filter(Boolean).join(' ')}
      style={{ background: seriesVar(index) }}
    />
  );
}
