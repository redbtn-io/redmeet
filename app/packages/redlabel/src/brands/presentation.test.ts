import { describe, expect, it } from 'vitest';

import { brandSchema, type Brand } from '../brand';
import { medshield } from './medshield';
import {
  BRAND_PRESENTATIONS,
  DEFAULT_PRESENTATION,
  brandPresentation,
  presentationFor,
  presentationStyle,
  presentationThemeCss,
} from './presentation';
import { redbtn } from './redbtn';
import { redbtnBeta } from './redbtn-beta';
import { COLOR_TOKEN_NAMES } from '../tokens';

/**
 * The client-safe subset, and the test that makes the literal table honest.
 *
 * The table is written out rather than projected, because importing the brand
 * files to build it would pull every whole record into any bundle that touches
 * the module, which is the leak the subset exists to prevent. That duplication is
 * only safe if drift is a red suite, which is what the first block is.
 */

const BRANDS: Array<[string, Brand]> = [
  ['redbtn', brandSchema.parse(redbtn)],
  ['redbtn-beta', brandSchema.parse(redbtnBeta)],
  ['medshield', brandSchema.parse(medshield)],
];

describe('the table equals the projection', () => {
  for (const [id, brand] of BRANDS) {
    it(`${id} matches brandPresentation()`, () => {
      expect(BRAND_PRESENTATIONS[id]).toEqual(brandPresentation(brand));
    });
  }

  it('covers every brand this package ships, and no others', () => {
    expect(Object.keys(BRAND_PRESENTATIONS).sort()).toEqual(BRANDS.map(([id]) => id).sort());
  });
});

describe('the subset is the five fields, and nothing that would leak', () => {
  it('carries exactly id, two surfaces, product short and support email', () => {
    for (const entry of Object.values(BRAND_PRESENTATIONS)) {
      expect(Object.keys(entry).sort()).toEqual(
        ['id', 'productShort', 'supportEmail', 'surfaceDark', 'surfaceLight'].sort(),
      );
    }
  });

  it('carries no other brand fact', () => {
    const serialized = JSON.stringify(BRAND_PRESENTATIONS);
    for (const absent of ['termsUrl', 'privacyUrl', 'fromAddress', 'productKey', 'appSlug', 'fonts', 'complianceNotice']) {
      expect(serialized).not.toContain(absent);
    }
  });

  it('both surfaces are literal colours a browser can paint with no CSS variable', () => {
    for (const entry of Object.values(BRAND_PRESENTATIONS)) {
      expect(entry.surfaceDark).toMatch(/^#[0-9a-f]{6}$/);
      expect(entry.surfaceLight).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('presentationFor is total', () => {
  it('an unknown, empty or absent id is the default brand’s face, never a throw', () => {
    expect(presentationFor('medshield').id).toBe('medshield');
    expect(presentationFor('nope')).toBe(DEFAULT_PRESENTATION);
    expect(presentationFor('')).toBe(DEFAULT_PRESENTATION);
    expect(presentationFor(null)).toBe(DEFAULT_PRESENTATION);
    expect(presentationFor(undefined)).toBe(DEFAULT_PRESENTATION);
    expect(presentationFor('a'.repeat(64))).toBe(DEFAULT_PRESENTATION);
  });
});

describe('the emitters', () => {
  it('the style attribute carries only what is correct in BOTH schemes', () => {
    const style = presentationStyle(presentationFor('medshield'));
    expect(style).toEqual({
      '--text-tertiary': 'color-mix(in srgb,var(--text-muted) 70%,var(--bg-primary))',
    });
    // A surface is scheme dependent, so it may never sit in an attribute that
    // outranks every selector.
    expect(JSON.stringify(style)).not.toContain('bg-primary:');
  });

  it('the scheme blocks are the same selector shape themeStyleCss emits', () => {
    expect(presentationThemeCss(presentationFor('medshield'))).toBe(
      ':root[data-brand="medshield"].dark,\n[data-brand="medshield"].dark{--bg-primary:#07101a}\n' +
        ':root[data-brand="medshield"].light,\n[data-brand="medshield"].light{--bg-primary:#fafafa}',
    );
  });

  it('every emitted selector names a scheme, exactly as the full emitter must', () => {
    for (const id of Object.keys(BRAND_PRESENTATIONS)) {
      const css = presentationThemeCss(presentationFor(id));
      const selectors = css
        .split('}')
        .map((block) => block.split('{')[0] ?? '')
        .join(',')
        .split(',')
        .map((selector) => selector.trim())
        .filter(Boolean);
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) {
        expect(selector.includes('.dark') || selector.includes('.light')).toBe(true);
        expect(selector).toContain('[data-brand=');
      }
    }
  });

  it('emits only bg-primary, so error-foreground falls back to the stylesheet literal', () => {
    // redlabel.css reads `var(--error-foreground, #ffffff)` precisely for this
    // surface, which replaces the root layout and has no branded root.
    for (const id of Object.keys(BRAND_PRESENTATIONS)) {
      const names = [...presentationThemeCss(presentationFor(id)).matchAll(/--([a-z0-9-]+)\s*:/g)].map(
        (match) => match[1],
      );
      expect(new Set(names)).toEqual(new Set(['bg-primary']));
      for (const name of names) expect(COLOR_TOKEN_NAMES as string[]).toContain(name);
    }
  });
});
