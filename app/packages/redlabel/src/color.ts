/**
 * sRGB colour parsing, WCAG 2.1 contrast, and the contrast gate.
 *
 * Everything here is pure arithmetic over a string. No React, no Next, no
 * environment, no IO, so `.` stays usable from a CLI, an email renderer and a
 * test (section 1.3).
 *
 * The gate exists because a whitelabel library that lets a reseller ship an
 * illegible accent has shipped the reseller a defect, not a feature. It is an
 * automated floor, not a design review: it checks the pairs redLabel itself
 * emits and nothing else (section 4.6).
 */
import type { Brand } from './brand';
import { resolveBrandColors, resolveExtraColors, ownedPropertyNames } from './tokens';

export interface Rgba {
  /** 0 to 255. */
  r: number;
  g: number;
  b: number;
  /** 0 to 1. */
  a: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*([^)]+)\)$/i;
const HSL = /^hsla?\(\s*([^)]+)\)$/i;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function channel(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  if (text.endsWith('%')) {
    const percent = Number(text.slice(0, -1));
    if (!Number.isFinite(percent)) return null;
    return clamp(Math.round((percent / 100) * 255), 0, 255);
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return clamp(Math.round(value), 0, 255);
}

function alpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const text = raw.trim();
  if (text.endsWith('%')) {
    const percent = Number(text.slice(0, -1));
    return Number.isFinite(percent) ? clamp(percent / 100, 0, 1) : 1;
  }
  const value = Number(text);
  return Number.isFinite(value) ? clamp(value, 0, 1) : 1;
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

/**
 * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`, `hsla()`.
 *
 * Deliberately NOT `color-mix()`, `var()`, `oklch()` or a named colour: every
 * brand INPUT colour must be resolvable to RGBA so the gate, the email palette
 * and the PDF palette can be computed. Derived values redLabel EMITS may use
 * `color-mix()`; brand input may not.
 */
export function parseColor(value: string | null | undefined): Rgba | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hex = HEX.exec(text);
  if (hex) {
    const digits = hex[1] as string;
    const expand = (pair: string): number => parseInt(pair.length === 1 ? pair + pair : pair, 16);
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: expand(digits[0] as string),
        g: expand(digits[1] as string),
        b: expand(digits[2] as string),
        a: digits.length === 4 ? expand(digits[3] as string) / 255 : 1,
      };
    }
    return {
      r: expand(digits.slice(0, 2)),
      g: expand(digits.slice(2, 4)),
      b: expand(digits.slice(4, 6)),
      a: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
    };
  }

  const rgb = RGB.exec(text);
  if (rgb) {
    const parts = (rgb[1] as string).split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (parts.length < 3) return null;
    const r = channel(parts[0] as string);
    const g = channel(parts[1] as string);
    const b = channel(parts[2] as string);
    if (r === null || g === null || b === null) return null;
    return { r, g, b, a: alpha(parts[3]) };
  }

  const hsl = HSL.exec(text);
  if (hsl) {
    const parts = (hsl[1] as string).split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (parts.length < 3) return null;
    const hue = Number((parts[0] as string).replace(/deg$/, ''));
    const saturation = Number((parts[1] as string).replace(/%$/, '')) / 100;
    const lightness = Number((parts[2] as string).replace(/%$/, '')) / 100;
    if (![hue, saturation, lightness].every(Number.isFinite)) return null;
    const { r, g, b } = hslToRgb(hue, clamp(saturation, 0, 1), clamp(lightness, 0, 1));
    return { r, g, b, a: alpha(parts[3]) };
  }

  return null;
}

export function isParseableColor(value: unknown): boolean {
  return typeof value === 'string' && parseColor(value) !== null;
}

/** `#rrggbb`, or `#rrggbbaa` when the colour is translucent. */
export function toHex(color: Rgba): string {
  const pair = (value: number): string =>
    clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  const base = `#${pair(color.r)}${pair(color.g)}${pair(color.b)}`;
  return color.a >= 1 ? base : `${base}${pair(color.a * 255)}`;
}

/** Source over destination, the ordinary alpha composite. */
export function composite(source: Rgba, destination: Rgba): Rgba {
  if (source.a >= 1) return source;
  const a = source.a + destination.a * (1 - source.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mixChannel = (s: number, d: number): number =>
    (s * source.a + d * destination.a * (1 - source.a)) / a;
  return {
    r: mixChannel(source.r, destination.r),
    g: mixChannel(source.g, destination.g),
    b: mixChannel(source.b, destination.b),
    a,
  };
}

function linearize(value: number): number {
  const channelValue = value / 255;
  return channelValue <= 0.04045
    ? channelValue / 12.92
    : Math.pow((channelValue + 0.055) / 1.055, 2.4);
}

function delinearize(value: number): number {
  const clamped = clamp(value, 0, 1);
  const channelValue =
    clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return clamp(Math.round(channelValue * 255), 0, 255);
}

/** WCAG 2.1 relative luminance over sRGB. */
export function relativeLuminance(color: Rgba): number {
  return (
    0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b)
  );
}

/**
 * WCAG 2.1 contrast ratio, 1 to 21.
 *
 * A translucent foreground is composited over the background first, which is
 * what a browser actually paints. A translucent BACKGROUND is composited over
 * opaque black, because this product is dark first and a token that is
 * translucent in redstyle (`accent-muted`, `backdrop`) sits on a dark surface.
 * Every background the gate uses is opaque in both of redstyle's schemes, so
 * this branch is a definition rather than a behaviour.
 *
 * An unparseable input returns 1, the worst possible ratio, so a typo fails the
 * gate rather than skipping it.
 */
export function contrastRatio(fg: string, bg: string): number {
  const foreground = parseColor(fg);
  const background = parseColor(bg);
  if (!foreground || !background) return 1;
  const solidBackground = composite(background, { r: 0, g: 0, b: 0, a: 1 });
  const solidForeground = composite(foreground, solidBackground);
  const a = relativeLuminance(solidForeground);
  const b = relativeLuminance(solidBackground);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/**
 * Black or white, whichever reads better on this surface.
 *
 * For every colour at least one of the two clears 4.5 (the luminance band where
 * neither does is empty), which is why `accent-foreground` can keep the text
 * threshold rather than dropping to the non-text floor.
 */
export function pickForeground(background: string): '#000000' | '#ffffff' {
  return contrastRatio('#000000', background) >= contrastRatio('#ffffff', background)
    ? '#000000'
    : '#ffffff';
}

/** sRGB linear interpolation, premultiplied, which is what `color-mix(in srgb, ...)` does. */
export function mixSrgb(a: string, b: string, aPercent: number): string {
  const left = parseColor(a);
  const right = parseColor(b);
  if (!left || !right) return a;
  const weight = clamp(aPercent, 0, 100) / 100;
  const alphaOut = left.a * weight + right.a * (1 - weight);
  if (alphaOut === 0) return toHex({ r: 0, g: 0, b: 0, a: 0 });
  const premultiplied = (l: number, r: number): number =>
    (l * left.a * weight + r * right.a * (1 - weight)) / alphaOut;
  return toHex({
    r: premultiplied(left.r, right.r),
    g: premultiplied(left.g, right.g),
    b: premultiplied(left.b, right.b),
    a: alphaOut,
  });
}

function srgbToOklab(color: Rgba): [number, number, number] {
  const r = linearize(color.r);
  const g = linearize(color.g);
  const b = linearize(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToSrgb(lab: [number, number, number], a: number): Rgba {
  const [L, A, B] = lab;
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: delinearize(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: delinearize(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: delinearize(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a,
  };
}

/** Perceptual interpolation, which is what `color-mix(in oklab, ...)` does. */
export function mixOklab(a: string, b: string, aPercent: number): string {
  const left = parseColor(a);
  const right = parseColor(b);
  if (!left || !right) return a;
  const weight = clamp(aPercent, 0, 100) / 100;
  const leftLab = srgbToOklab(left);
  const rightLab = srgbToOklab(right);
  const lab: [number, number, number] = [
    leftLab[0] * weight + rightLab[0] * (1 - weight),
    leftLab[1] * weight + rightLab[1] * (1 - weight),
    leftLab[2] * weight + rightLab[2] * (1 - weight),
  ];
  return toHex(oklabToSrgb(lab, left.a * weight + right.a * (1 - weight)));
}

/**
 * The one function redLabel and the emitted CSS agree on, so the literal a PDF
 * or an email gets is within a rounding step of what a browser paints.
 */
export function mix(a: string, b: string, aPercent: number, space: 'srgb' | 'oklab'): string {
  return space === 'oklab' ? mixOklab(a, b, aPercent) : mixSrgb(a, b, aPercent);
}

/* ------------------------------------------------------- the contrast gate -- */

interface ContrastPair {
  /** Bare property names, as in COLOR_TOKEN_NAMES and EXTRA_PROPERTIES. */
  fg: string;
  bg: string;
  min: number;
  why: string;
}

const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'accent-foreground', bg: 'accent', min: 4.5, why: 'button label on the primary action' },
  { fg: 'accent-text', bg: 'bg-primary', min: 4.5, why: 'accent coloured body text and links' },
  { fg: 'accent-text', bg: 'bg-secondary', min: 4.5, why: 'the same text inside a card' },
  { fg: 'text-primary', bg: 'bg-primary', min: 4.5, why: 'body text on the page' },
  { fg: 'error-foreground', bg: 'error', min: 4.5, why: "the destructive button's label" },
  { fg: 'accent', bg: 'bg-primary', min: 3.0, why: 'a filled accent control against the page' },
];

/**
 * Every pair this brand broke, as sentences.
 *
 * **The gate judges what redLabel is responsible for, and only that.** A pair is
 * evaluated only when at least one side is a brand-supplied value or a
 * redLabel-derived one. A pair whose two sides are both redstyle defaults the
 * brand never touched is not this brand's defect and not this brand author's to
 * fix; it is an upstream item (section 4.9).
 *
 * That scoping is the difference between a gate that works and a gate that
 * bricks the build: redstyle 0.6.2 ships `#ffffff` on `#ef4444` at 3.76 and
 * light `#dc2626` on `#f4f4f5` at 4.39, so an unscoped gate rejects the default
 * `redbtn` brand, which overrides nothing, and `createRegistry` throws at module
 * load before the app can boot.
 */
export function contrastIssues(brand: Brand, scheme: 'dark' | 'light'): string[] {
  const colors = resolveBrandColors(brand, scheme);
  const extras = resolveExtraColors(brand, scheme);
  const owned = ownedPropertyNames(brand, scheme);
  const literal = (name: string): string | undefined =>
    (colors as Record<string, string | undefined>)[name] ??
    (extras as Record<string, string | undefined>)[name];

  const issues: string[] = [];
  for (const pair of CONTRAST_PAIRS) {
    if (!owned.has(pair.fg) && !owned.has(pair.bg)) continue;
    const fg = literal(pair.fg);
    const bg = literal(pair.bg);
    if (fg === undefined || bg === undefined) continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio < pair.min) {
      issues.push(
        `${scheme}: ${pair.fg} (${fg}) on ${pair.bg} (${bg}) is ${ratio.toFixed(2)}, ` +
          `below ${pair.min.toFixed(1)}, which is ${pair.why}`,
      );
    }
  }
  return issues;
}
