import { describe, expect, it } from 'vitest';

import { brandSchema, type Brand, type BrandInput } from './brand';
import { medshield } from './brands/medshield';
import { redbtn } from './brands/redbtn';
import { redbtnBeta } from './brands/redbtn-beta';
import { contrastRatio, parseColor } from './color';
import {
  COLOR_TOKEN_NAMES,
  EXTRA_PROPERTIES,
  brandStyle,
  brandStyleString,
  resolveBrandColors,
  themeStyleCss,
  tokenNameSchema,
} from './tokens';

/** Section 10.2. Assertions on the EXACT string, not a normalized parse. */

const REDBTN: Brand = brandSchema.parse(redbtn);
const REDBTN_BETA: Brand = brandSchema.parse(redbtnBeta);
const MEDSHIELD: Brand = brandSchema.parse(medshield);

function fixture(tokens: BrandInput['tokens']): Brand {
  return brandSchema.parse({
    id: 'fixture',
    hosts: ['fixture.example.com'],
    origin: 'https://fixture.example.com',
    product: { name: 'Fixture', short: 'Fixture' },
    logo: { markUrl: '/brand/fixture/icon-192.png', masterUrl: '/brand/fixture/logo.png' },
    tokens,
    legal: { companyName: 'Fixture' },
    support: { email: 'support@fixture.example.com' },
    email: { appName: 'Fixture', accentColor: '#0088dd', fromAddress: 'noreply@fixture.example.com' },
    auth: { mode: 'isolated', cookieName: 'fixture_session', secretEnv: 'FIXTURE_JWT_SECRET' },
    features: {
      sast: true, sca: true, secrets: true, sbom: true, aiTriage: true, aiFix: true,
      githubConnect: true, zipUpload: true, schedules: true, ciKeys: true,
      billing: false, notifications: true,
    },
  });
}

describe('themeStyleCss, the default brand', () => {
  it('is exactly the two one-declaration blocks of redlabel.md 4.3', () => {
    expect(themeStyleCss(REDBTN)).toBe(
      ':root[data-brand="redbtn"].dark,\n' +
        '[data-brand="redbtn"].dark{--error-foreground:#000000}\n' +
        ':root[data-brand="redbtn"].light,\n' +
        '[data-brand="redbtn"].light{--error-foreground:#ffffff}',
    );
  });

  it('emits no redstyle-declared token anywhere, which is the 9.1 invariant', () => {
    const css = themeStyleCss(REDBTN) + brandStyleString(REDBTN);
    for (const name of COLOR_TOKEN_NAMES) {
      expect(css).not.toContain(`--${name}:`);
    }
  });

  it('brandStyle is the one hoisted extra property', () => {
    expect(brandStyle(REDBTN)).toEqual({
      '--text-tertiary': 'color-mix(in srgb,var(--text-muted) 70%,var(--bg-primary))',
    });
  });

  it('redbtn-beta differs from redbtn in no emitted property', () => {
    expect(themeStyleCss(REDBTN_BETA)).toBe(themeStyleCss(REDBTN).replaceAll('redbtn', 'redbtn-beta'));
    expect(brandStyle(REDBTN_BETA)).toEqual(brandStyle(REDBTN));
  });
});

describe('themeStyleCss, the demo reseller', () => {
  it('is exactly the two blocks of redlabel.md 4.3, verbatim', () => {
    expect(themeStyleCss(MEDSHIELD)).toBe(
      ':root[data-brand="medshield"].dark,\n' +
        '[data-brand="medshield"].dark{' +
        '--accent:#0ea5e9;' +
        '--accent-hover:color-mix(in oklab,#0ea5e9 85%,#000);' +
        '--accent-muted:color-mix(in srgb,#0ea5e9 10%,transparent);' +
        '--accent-text:#0ea5e9;' +
        '--bg-primary:#07101a;' +
        '--bg-secondary:#0d1b26;' +
        '--border-focus:color-mix(in srgb,#0ea5e9 50%,transparent);' +
        '--error-foreground:#000000}\n' +
        ':root[data-brand="medshield"].light,\n' +
        '[data-brand="medshield"].light{' +
        '--accent:#0284c7;' +
        '--accent-hover:color-mix(in oklab,#0284c7 85%,#000);' +
        '--accent-muted:color-mix(in srgb,#0284c7 10%,transparent);' +
        '--accent-text:#0369a1;' +
        '--border-focus:color-mix(in srgb,#0284c7 50%,transparent);' +
        '--error-foreground:#ffffff}',
    );
  });

  it('--accent is in the scheme blocks and NOT in the style attribute', () => {
    // The hoist rejects it because the two schemes differ: #0ea5e9 reads at 6.90
    // on medshield's dark surface and 2.66 on redstyle's light one.
    expect(Object.keys(brandStyle(MEDSHIELD))).not.toContain('--accent');
    expect(themeStyleCss(MEDSHIELD)).toContain('--accent:#0ea5e9');
    expect(themeStyleCss(MEDSHIELD)).toContain('--accent:#0284c7');
  });

  it('brandStyle carries the hoisted foreground and the font remap, and nothing else', () => {
    expect(brandStyle(MEDSHIELD)).toEqual({
      '--accent-foreground': '#000000',
      '--font-geist-sans': '"Inter", ui-sans-serif, system-ui, sans-serif',
      '--text-tertiary': 'color-mix(in srgb,var(--text-muted) 70%,var(--bg-primary))',
    });
  });

  it('a dark-only surface override appears in the dark block AND NOWHERE ELSE', () => {
    // This is the defect the scheme-less selector shipped: `--bg-primary:#07101a`
    // applied under `.light` at a specificity that merely TIED redstyle's
    // `:root.light`, so light mode painted `--text-primary: #18181b` on `#07101a`
    // at a ratio of about 1.1.
    const [dark, light] = themeStyleCss(MEDSHIELD).split('\n:root[data-brand="medshield"].light');
    expect(dark).toContain('--bg-primary:#07101a');
    expect(dark).toContain('--bg-secondary:#0d1b26');
    expect(light).not.toContain('--bg-primary');
    expect(light).not.toContain('--bg-secondary');
  });
});

describe('the emitted selector list', () => {
  const brands = [REDBTN, REDBTN_BETA, MEDSHIELD, fixture({ shared: { accent: '#0088dd' }, dark: {}, light: {} })];

  function selectorsOf(css: string): string[] {
    return css
      .split('}')
      .map((block) => block.split('{')[0] ?? '')
      .join(',')
      .split(',')
      .map((selector) => selector.trim())
      .filter(Boolean);
  }

  it('every emitted selector names a scheme', () => {
    for (const brand of brands) {
      for (const selector of selectorsOf(themeStyleCss(brand))) {
        expect(selector.includes('.dark') || selector.includes('.light')).toBe(true);
      }
    }
  });

  it('no selector that names one scheme can match the other', () => {
    for (const brand of brands) {
      for (const selector of selectorsOf(themeStyleCss(brand))) {
        if (selector.includes('.dark')) expect(selector).not.toContain('.light');
        if (selector.includes('.light')) expect(selector).not.toContain('.dark');
      }
    }
  });

  it('every emitted selector also names the brand, so nothing sits at redstyle specificity', () => {
    for (const brand of brands) {
      for (const selector of selectorsOf(themeStyleCss(brand))) {
        expect(selector).toContain('[data-brand=');
      }
    }
  });

  it('the descendant scope leads with the scheme class and carries no :root', () => {
    const brand = fixture({ shared: { accent: '#0088dd' }, dark: {}, light: {} });
    const css = themeStyleCss(brand, { scope: 'descendant' });
    expect(css).not.toContain(':root');
    const selectors = selectorsOf(css);
    expect(selectors[0]).toBe('.dark [data-brand="fixture"]');
    expect(selectors).toContain('.light [data-brand="fixture"]');
    // The same declaration bodies as the root scope output.
    const bodies = (text: string): string[] =>
      text.split('{').slice(1).map((block) => block.split('}')[0] ?? '');
    expect(bodies(css)).toEqual(bodies(themeStyleCss(brand)));
  });

  it('is sorted by property name, so the output is stable', () => {
    const brand = fixture({ shared: {}, dark: { accent: '#0088dd', 'bg-primary': '#07101a' }, light: {} });
    const body = themeStyleCss(brand).split('{')[1]?.split('}')[0] ?? '';
    const names = body.split(';').map((declaration) => declaration.split(':')[0] ?? '');
    expect(names).toEqual([...names].sort());
  });

  it('every emitted property name is a token name or an extra property', () => {
    const known = new Set<string>([...COLOR_TOKEN_NAMES, ...EXTRA_PROPERTIES]);
    for (const brand of brands) {
      const text = themeStyleCss(brand) + brandStyleString(brand);
      for (const match of text.matchAll(/--([a-z0-9-]+)\s*:/g)) {
        // `var(--text-muted)` inside a derived value is a READ, not an emission.
        if (text.includes(`var(--${match[1]}`)) continue;
        expect(known.has(match[1] as string)).toBe(true);
      }
    }
  });

  it('a brand id cannot escape the attribute selector', () => {
    expect(() => brandSchema.parse({ ...redbtn, id: 'ev"il' })).toThrow();
    expect(() => brandSchema.parse({ ...redbtn, id: 'ev\\il' })).toThrow();
  });
});

describe('the partition between brandStyle and themeStyleCss', () => {
  const brands = [REDBTN, REDBTN_BETA, MEDSHIELD, fixture({ shared: { accent: '#0088dd' }, dark: {}, light: {} })];

  /**
   * **CORRECTION to redlabel.md 10.2.** That section's partition row says a
   * fixture brand with `shared.accent` only "puts `--accent` and its whole
   * derived family in `brandStyle` and emits an empty `themeStyleCss` body". The
   * body can never be empty, and no emitter change could make it so:
   *
   * - `accent-text` derives to the accent itself in dark and to
   *   `color-mix(in oklab, <accent> 80%, #000)` in light (4.4), so it differs
   *   between the schemes by construction and the hoist cannot take it.
   * - `error-foreground` derives from the RESOLVED `error`, which is redstyle's
   *   own `#f87171` in dark and `#b91c1c` in light, so it is `#000000` in one
   *   scheme and `#ffffff` in the other for every brand that does not override
   *   `error` to something unusual. The default `redbtn` brand proves it: 4.3
   *   prints its two one-declaration blocks, and that declaration is exactly
   *   this one.
   *
   * So the row is restated: `--accent` and the three scheme-independent members
   * of its family hoist, and the two scheme-dependent derivations stay in the
   * blocks. A seam request asks for the sentence in 10.2 to be reworded.
   */
  it('shared.accent alone hoists the accent and the scheme-independent family', () => {
    const brand = fixture({ shared: { accent: '#0088dd' }, dark: {}, light: {} });
    expect(Object.keys(brandStyle(brand)).sort()).toEqual([
      '--accent',
      '--accent-foreground',
      '--accent-hover',
      '--accent-muted',
      '--border-focus',
      '--text-tertiary',
    ]);
  });

  it('and leaves exactly the two scheme-dependent derivations in the blocks', () => {
    const brand = fixture({ shared: { accent: '#0088dd' }, dark: {}, light: {} });
    const names = [...themeStyleCss(brand).matchAll(/--([a-z0-9-]+)\s*:/g)].map((match) => match[1]);
    expect(new Set(names)).toEqual(new Set(['accent-text', 'error-foreground']));
  });

  it('shares no property name for any brand', () => {
    for (const brand of brands) {
      const hoisted = new Set(Object.keys(brandStyle(brand)).map((name) => name.slice(2)));
      const css = themeStyleCss(brand);
      for (const name of hoisted) {
        expect(css).not.toContain(`--${name}:`);
      }
    }
  });

  it('hoists a value that is identical in both schemes', () => {
    // An accent that derives the same foreground in both schemes hoists it, and
    // nothing scheme-dependent joins it.
    const brand = fixture({ shared: { accent: '#0088dd' }, dark: {}, light: {} });
    expect(Object.keys(brandStyle(brand))).toContain('--accent');
    expect(Object.keys(brandStyle(brand))).toContain('--accent-foreground');
    expect(themeStyleCss(brand)).not.toContain('--accent:');
  });

  it('an explicit scheme value is never beaten by a derived one', () => {
    // This is the case where a derived `accent-hover` from `shared.accent` used
    // to go inline, where an attribute outranks every selector, so the brand's
    // explicit light value never applied.
    const brand = fixture({
      shared: { accent: '#0088dd' },
      dark: { 'accent-hover': '#006ab0' },
      light: {},
    });
    expect(themeStyleCss(brand)).toContain('--accent-hover:#006ab0');
    expect(Object.keys(brandStyle(brand))).not.toContain('--accent-hover');
  });

  it('emits the font remap only when the brand states a family', () => {
    expect(Object.keys(brandStyle(REDBTN))).not.toContain('--font-geist-sans');
    const brand = fixture({ shared: {}, dark: {}, light: {} });
    const withFont = brandSchema.parse({
      ...redbtn,
      id: 'fonted',
      fonts: {
        sansHref: null,
        monoHref: null,
        sansFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
        monoFamily: null,
      },
    });
    expect(brandStyle(withFont)['--font-geist-sans']).toBe(
      '"Inter", ui-sans-serif, system-ui, sans-serif',
    );
    expect(themeStyleCss(withFont)).not.toContain('--font-geist-sans');
    expect(Object.keys(brandStyle(brand))).not.toContain('--font-geist-mono');
  });
});

describe('resolveBrandColors', () => {
  it('returns a parseable literal for every colour token, for every shipped brand and both schemes', () => {
    for (const brand of [REDBTN, REDBTN_BETA, MEDSHIELD]) {
      for (const scheme of ['dark', 'light'] as const) {
        const colors = resolveBrandColors(brand, scheme);
        for (const name of COLOR_TOKEN_NAMES) {
          const value = colors[name];
          expect(typeof value).toBe('string');
          expect(parseColor(value)).not.toBeNull();
        }
      }
    }
  });

  it('excludes exactly the six shadow size names', () => {
    for (const name of ['shadow-xs', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl', 'shadow-2xl']) {
      expect(COLOR_TOKEN_NAMES as string[]).not.toContain(name);
      expect(tokenNameSchema.safeParse(name).success).toBe(false);
    }
    expect(COLOR_TOKEN_NAMES as string[]).toContain('shadow-color');
    expect(COLOR_TOKEN_NAMES as string[]).toContain('backdrop');
  });

  it('agrees with the emitted color-mix within one step per channel', () => {
    const brand = fixture({ shared: { accent: '#0088dd' }, dark: {}, light: {} });
    const colors = resolveBrandColors(brand, 'dark');
    // `accent-muted` is `color-mix(in srgb, accent 10%, transparent)`, which is
    // the accent at alpha 0.1.
    const muted = parseColor(colors['accent-muted']);
    const accent = parseColor('#0088dd');
    expect(colors['accent']).toBe('#0088dd');
    expect(muted).not.toBeNull();
    expect(accent).not.toBeNull();
    expect(Math.abs((muted?.r ?? 0) - (accent?.r ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((muted?.a ?? 0) - 0.1)).toBeLessThanOrEqual(1 / 255);
  });

  it('the default brand resolves to redstyle values untouched', () => {
    const dark = resolveBrandColors(REDBTN, 'dark');
    expect(dark['accent']).toBe('#ef4444');
    expect(dark['accent-foreground']).toBe('#ffffff');
    expect(dark['bg-primary']).toBe('#0a0a0a');
    const light = resolveBrandColors(REDBTN, 'light');
    expect(light['bg-primary']).toBe('#fafafa');
    expect(light['accent-text']).toBe('#dc2626');
  });
});

describe('contrastRatio, against hardcoded expectations', () => {
  const cases: Array<[string, string, number]> = [
    ['#000000', '#ffffff', 21],
    ['#ffffff', '#ffffff', 1],
    ['#ffffff', '#ef4444', 3.76],
    ['#0ea5e9', '#fafafa', 2.66],
    ['#0284c7', '#fafafa', 3.92],
    ['#000000', '#f87171', 7.59],
    ['#ffffff', '#b91c1c', 6.47],
  ];
  for (const [fg, bg, expected] of cases) {
    it(`${fg} on ${bg} is ${expected}`, () => {
      expect(contrastRatio(fg, bg)).toBe(expected);
    });
  }
});
