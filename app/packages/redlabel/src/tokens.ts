/**
 * The token layer: the only file in this package allowed to read redstyle's
 * token VALUES (section 4.8 leak 5).
 *
 * It reads them deliberately. `darkTokens` and `lightTokens` are the BASE
 * PALETTE: every brand starts from redstyle's own values and overrides a
 * handful, so a token the brand never mentions still has a literal for the
 * contrast gate, for email and for PDF. `BRAND_RED`, `BRAND_RED_HOVER`,
 * `getToken`, `chartSeriesHex` and `chartHeatHex` are never read, here or
 * anywhere.
 *
 * Two emitters, and the partition between them is COMPUTED, never guessed
 * (section 4.2):
 *
 *   emitted(scheme) = declared(scheme) union derived(scheme)
 *     declared(scheme) = { ...tokens.shared, ...tokens[scheme] }
 *     derived(scheme)  = deriveTokens(declared(scheme), scheme)
 *
 * then a key whose value is byte identical in both schemes is HOISTED into the
 * `<html>` style attribute, and every other key goes into `ThemeStyle` in the
 * scheme block it belongs to. The two outputs are disjoint by construction, so
 * a derived value can never silently beat an explicitly declared one and the
 * brand author never has to know which bucket a token landed in.
 */
import {
  chartHeat,
  chartSeries,
  cssVar,
  darkTokens,
  lightTokens,
  type TokenName,
} from '@redbtn/redstyle/tokens';
import { z } from 'zod';

import type { Brand } from './brand';
import { mix, pickForeground } from './color';

/**
 * Six of redstyle's 56 token names hold BOX-SHADOW LISTS, not colours:
 * `shadow-sm` is `'0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)'`.
 * `parseColor` cannot parse them, `contrastRatio` cannot use them and
 * `resolveBrandColors` cannot return a hex for them, so they are excluded BY
 * NAME rather than left to fail at runtime. `shadow-color` and `backdrop` stay:
 * both are rgba() and both are colours a brand may legitimately want to tint.
 */
const NON_COLOR_TOKENS = [
  'shadow-xs',
  'shadow-sm',
  'shadow-md',
  'shadow-lg',
  'shadow-xl',
  'shadow-2xl',
] as const;

export type ColorTokenName = Exclude<TokenName, (typeof NON_COLOR_TOKENS)[number]>;

export const COLOR_TOKEN_NAMES: ColorTokenName[] = (Object.keys(darkTokens) as TokenName[]).filter(
  (name): name is ColorTokenName => !(NON_COLOR_TOKENS as readonly string[]).includes(name),
);

export const tokenNameSchema = z.enum(
  COLOR_TOKEN_NAMES as [ColorTokenName, ...ColorTokenName[]],
);

/**
 * Properties redLabel emits that redstyle does not declare, so they are not
 * members of `TokenName`, cannot be keys of `tokenNameSchema` and cannot be
 * brand overridable.
 *
 * BARE names, exactly like `COLOR_TOKEN_NAMES`. The single emitter helper adds
 * the `--` once, for both lists, which is what keeps the 10.2 property-name
 * assertion honest: its regex captures a bare name and compares it against
 * these two lists directly.
 */
export const EXTRA_PROPERTIES = [
  'text-tertiary',
  'error-foreground',
  'font-geist-sans',
  'font-geist-mono',
] as const;
export type ExtraProperty = (typeof EXTRA_PROPERTIES)[number];

/**
 * `var(--name)` for a token, the live form.
 *
 * This is the ONLY way anything outside this file reads a redstyle token, and
 * it is deliberately the reference rather than the value: a `var()` tracks the
 * theme AND any brand override at runtime, where a resolved hex freezes one
 * brand's palette into the markup. `src/charts.ts` is built on it.
 */
export function tokenVar(name: ColorTokenName): string {
  return cssVar(name);
}

/**
 * How many categorical slots and how many heat steps redstyle declares.
 *
 * The chart palettes are seeded from the LENGTH of redstyle's own lists rather
 * than from a literal `8` and `7`, so a redstyle release that adds a slot is a
 * palette that grows, not a palette that silently truncates.
 */
export const CHART_SERIES_COUNT: number = chartSeries.length;
export const CHART_HEAT_COUNT: number = chartHeat.length;

/** A map of custom properties. Deliberately NOT `React.CSSProperties`. */
export type CssVarMap = Record<`--${string}`, string>;

export type Scheme = 'dark' | 'light';

/** The accent family redLabel derives when, and only when, a brand states an accent. */
const ACCENT_DERIVED = [
  'accent-hover',
  'accent-muted',
  'border-focus',
  'accent-text',
  'accent-foreground',
] as const;

function basePalette(scheme: Scheme): Readonly<Record<string, string>> {
  return (scheme === 'dark' ? darkTokens : lightTokens) as Readonly<Record<string, string>>;
}

/** `{ ...tokens.shared, ...tokens[scheme] }`: exactly what the brand author wrote. */
export function declaredTokens(brand: Brand, scheme: Scheme): Record<string, string> {
  return { ...brand.tokens.shared, ...brand.tokens[scheme] };
}

/**
 * Fill a token ONLY when that name is absent from `declared` for that scheme, so
 * an explicit brand value always wins in the scheme where it is declared and the
 * other scheme still derives.
 *
 * Derivation from `accent` is CONDITIONAL on the brand declaring an accent. A
 * brand that overrides nothing derives nothing from nothing, which is what makes
 * "the default brand is exactly redstyle" true rather than aspirational: an
 * unconditional derivation would replace redstyle's shipped white
 * `--accent-foreground` with black on every page of the flagship product.
 *
 * The values are CSS, so the mixes stay `color-mix()`: baseline available, short
 * to read, and legible in devtools. `accent-foreground` and `error-foreground`
 * are literals because a choice between two colours is not a mix.
 */
export function deriveTokens(declared: Record<string, string>, scheme: Scheme): Record<string, string> {
  const base = basePalette(scheme);
  const derived: Record<string, string> = {};
  const accent = declared['accent'];

  if (accent !== undefined) {
    const formula: Record<(typeof ACCENT_DERIVED)[number], string> = {
      'accent-hover': `color-mix(in oklab,${accent} 85%,#000)`,
      'accent-muted': `color-mix(in srgb,${accent} 10%,transparent)`,
      'border-focus': `color-mix(in srgb,${accent} 50%,transparent)`,
      'accent-text': scheme === 'dark' ? accent : `color-mix(in oklab,${accent} 80%,#000)`,
      'accent-foreground': pickForeground(accent),
    };
    for (const name of ACCENT_DERIVED) {
      if (declared[name] === undefined) derived[name] = formula[name];
    }
  }

  // Always, because redstyle declares neither and both are read with a
  // `var(--x, <literal>)` fallback inside redLabel's own stylesheet.
  derived['error-foreground'] = pickForeground(declared['error'] ?? (base['error'] as string));
  derived['text-tertiary'] = 'color-mix(in srgb,var(--text-muted) 70%,var(--bg-primary))';

  return derived;
}

/** declared union derived: every property this brand is answerable for. */
export function ownedPropertyNames(brand: Brand, scheme: Scheme): Set<string> {
  const declared = declaredTokens(brand, scheme);
  const derived = deriveTokens(declared, scheme);
  return new Set([...Object.keys(declared), ...Object.keys(derived)]);
}

/** Everything this brand paints in one scheme, as CSS values. */
function emittedProperties(brand: Brand, scheme: Scheme): Record<string, string> {
  const declared = declaredTokens(brand, scheme);
  return { ...deriveTokens(declared, scheme), ...declared };
}

/**
 * The whole palette as literal colour, for email, PDF, OG images and the
 * contrast gate, none of which has `color-mix()`.
 *
 * Typed on `ColorTokenName`, not `TokenName`, because six of redstyle's names
 * hold box-shadow lists. One derivation, two renderings, and `color.test.ts`
 * asserts they agree.
 */
export function resolveBrandColors(brand: Brand, scheme: Scheme): Record<ColorTokenName, string> {
  const base = basePalette(scheme);
  const declared = declaredTokens(brand, scheme);
  const accent = declared['accent'];
  const out = {} as Record<ColorTokenName, string>;

  for (const name of COLOR_TOKEN_NAMES) {
    const value = declared[name] ?? base[name];
    out[name] = value as string;
  }

  if (accent !== undefined) {
    if (declared['accent-hover'] === undefined) out['accent-hover' as ColorTokenName] = mix(accent, '#000000', 85, 'oklab');
    if (declared['accent-muted'] === undefined) out['accent-muted' as ColorTokenName] = mix(accent, 'transparent', 10, 'srgb');
    if (declared['border-focus'] === undefined) out['border-focus' as ColorTokenName] = mix(accent, 'transparent', 50, 'srgb');
    if (declared['accent-text'] === undefined) {
      out['accent-text' as ColorTokenName] = scheme === 'dark' ? accent : mix(accent, '#000000', 80, 'oklab');
    }
    if (declared['accent-foreground'] === undefined) {
      out['accent-foreground' as ColorTokenName] = pickForeground(accent);
    }
  }

  return out;
}

/** The two colour EXTRA properties, as literals, for the same consumers. */
export function resolveExtraColors(
  brand: Brand,
  scheme: Scheme,
): Record<'text-tertiary' | 'error-foreground', string> {
  const colors = resolveBrandColors(brand, scheme);
  return {
    'error-foreground': pickForeground(colors['error' as ColorTokenName]),
    'text-tertiary': mix(
      colors['text-muted' as ColorTokenName],
      colors['bg-primary' as ColorTokenName],
      70,
      'srgb',
    ),
  };
}

/* ------------------------------------------------------------- emitters -- */

function fontProperties(brand: Brand): Record<string, string> {
  const fonts: Record<string, string> = {};
  if (brand.fonts.sansFamily !== null) fonts['font-geist-sans'] = brand.fonts.sansFamily;
  if (brand.fonts.monoFamily !== null) fonts['font-geist-mono'] = brand.fonts.monoFamily;
  return fonts;
}

interface Partition {
  hoisted: Record<string, string>;
  dark: Record<string, string>;
  light: Record<string, string>;
}

/**
 * The hoist. A key whose value is byte identical in both schemes goes to the
 * style attribute; everything else goes to its scheme block.
 *
 * An inline style attribute outranks every selector and sits in the first byte
 * of HTML, so it cannot flash. That is exactly why only a value that is correct
 * in BOTH schemes may live there.
 */
function partition(brand: Brand): Partition {
  const dark = emittedProperties(brand, 'dark');
  const light = emittedProperties(brand, 'light');
  const hoisted: Record<string, string> = { ...fontProperties(brand) };
  const darkOnly: Record<string, string> = {};
  const lightOnly: Record<string, string> = {};

  for (const name of new Set([...Object.keys(dark), ...Object.keys(light)])) {
    const inDark = dark[name];
    const inLight = light[name];
    if (inDark !== undefined && inDark === inLight) {
      hoisted[name] = inDark;
      continue;
    }
    if (inDark !== undefined) darkOnly[name] = inDark;
    if (inLight !== undefined) lightOnly[name] = inLight;
  }

  return { hoisted, dark: darkOnly, light: lightOnly };
}

function toCssVarMap(properties: Record<string, string>): CssVarMap {
  const out: CssVarMap = {};
  for (const name of Object.keys(properties).sort()) {
    out[`--${name}`] = properties[name] as string;
  }
  return out;
}

/** The `<html>` style attribute: every property that is correct in both schemes. */
export function brandStyle(brand: Brand): CssVarMap {
  return toCssVarMap(partition(brand).hoisted);
}

/** The same map as a `style="..."` string, for a non-React emitter. */
export function brandStyleString(brand: Brand): string {
  return Object.entries(brandStyle(brand))
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
}

export type ThemeScope = 'root' | 'descendant';

function declarations(properties: Record<string, string>): string {
  return Object.keys(properties)
    .sort()
    .map((name) => `--${name}:${properties[name] as string}`)
    .join(';');
}

function selectors(brandId: string, scheme: Scheme, scope: ThemeScope): string {
  const attribute = `[data-brand="${brandId}"]`;
  // EVERY emitted selector names a scheme, and each is at least one specificity
  // step above redstyle's `:root.dark` / `:root.light` (0,2,0), so it wins
  // regardless of source order and can never apply under the wrong scheme. A
  // scheme-less selector merely TIES redstyle's light declarations, which is how
  // a dark-only surface override once painted `#18181b` on `#07101a`.
  if (scope === 'descendant') {
    // The wrapper carries `data-brand` alone under an `<html>` that carries the
    // scheme class, so the root-scope selectors cannot serve it. `.dark [x]`
    // does not match `<html>`, so a descendant emission never disturbs the root.
    return `.${scheme} ${attribute},\n${attribute}.${scheme}`;
  }
  return `:root${attribute}.${scheme},\n${attribute}.${scheme}`;
}

/**
 * The per-scheme override blocks, as text. Pure, so it lives in `.` where React
 * may not be imported; `<ThemeStyle>` in `./theme` renders it.
 *
 * Keys are sorted so the output is deterministic and diffable. Values are
 * emitted verbatim from a `cssColorSchema`-validated string or from a
 * redLabel-generated `color-mix()`, and `brandIdSchema` forbids the quote and
 * backslash characters that could break out of the attribute selector, so there
 * is no interpolation of untrusted input anywhere in the result.
 */
export function themeStyleCss(brand: Brand, options?: { scope?: ThemeScope }): string {
  const scope = options?.scope ?? 'root';
  const { dark, light } = partition(brand);
  const blocks: string[] = [];
  for (const scheme of ['dark', 'light'] as const) {
    const properties = scheme === 'dark' ? dark : light;
    if (Object.keys(properties).length === 0) continue;
    blocks.push(`${selectors(brand.id, scheme, scope)}{${declarations(properties)}}`);
  }
  return blocks.join('\n');
}
