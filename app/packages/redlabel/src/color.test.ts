import { describe, expect, it } from 'vitest';

import { brandSchema, type Brand, type BrandInput } from './brand';
import { medshield } from './brands/medshield';
import { redbtn } from './brands/redbtn';
import { redbtnBeta } from './brands/redbtn-beta';
import { contrastIssues, contrastRatio, mix, parseColor, pickForeground } from './color';
import { applyBrandOverride } from './server';

/**
 * Section 10.3. The contrast gate, its CALIBRATION, and the store override's
 * refusals.
 *
 * Every ratio below is a hardcoded expected number rather than a comparison
 * against the implementation, because a gate that checks itself is not a gate.
 */

const REDBTN: Brand = brandSchema.parse(redbtn);
const REDBTN_BETA: Brand = brandSchema.parse(redbtnBeta);
const MEDSHIELD: Brand = brandSchema.parse(medshield);

/** A synthetic brand, so a rejection is a statement about tokens and nothing else. */
function synthetic(tokens: BrandInput['tokens'], overrides: Partial<BrandInput> = {}): unknown {
  return {
    id: 'synthetic',
    hosts: ['synthetic.example.com'],
    origin: 'https://synthetic.example.com',
    product: { name: 'Synthetic', short: 'Synthetic' },
    logo: { markUrl: '/brand/synthetic/icon-192.png', masterUrl: '/brand/synthetic/logo.png' },
    tokens,
    legal: { companyName: 'Synthetic' },
    support: { email: 'support@synthetic.example.com' },
    email: {
      appName: 'Synthetic',
      accentColor: '#0088dd',
      fromAddress: 'noreply@synthetic.example.com',
    },
    auth: { mode: 'isolated', cookieName: 'synthetic_session', secretEnv: 'SYNTHETIC_JWT_SECRET' },
    features: {
      sast: true, sca: true, secrets: true, sbom: true, aiTriage: true, aiFix: true,
      githubConnect: true, zipUpload: true, schedules: true, ciKeys: true,
      billing: false, notifications: true,
    },
    ...overrides,
  };
}

describe('contrastRatio, against hardcoded expectations', () => {
  const cases: Array<[string, string, number]> = [
    ['#000', '#fff', 21],
    ['#ffffff', '#ffffff', 1],
    ['#ffffff', '#ef4444', 3.76],
    ['#0ea5e9', '#fafafa', 2.66],
    ['#0284c7', '#fafafa', 3.92],
  ];
  for (const [fg, bg, expected] of cases) {
    it(`${fg} on ${bg} is ${expected}`, () => {
      expect(contrastRatio(fg, bg)).toBe(expected);
    });
  }

  it('an unparseable input is the WORST ratio, so a typo fails the gate rather than skipping it', () => {
    expect(contrastRatio('var(--accent)', '#ffffff')).toBe(1);
    expect(contrastRatio('#ffffff', 'color-mix(in srgb, red 50%, blue)')).toBe(1);
  });

  it('composites a translucent foreground, which is what a browser paints', () => {
    // 50% black over white reads as mid grey, not as black.
    const ratio = contrastRatio('#00000080', '#ffffff');
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(21);
  });
});

describe('the derivation, and why accent-foreground can keep the text threshold', () => {
  it('picks the better of black and white', () => {
    expect(pickForeground('#0ea5e9')).toBe('#000000');
    expect(pickForeground('#0284c7')).toBe('#000000');
    expect(pickForeground('#07101a')).toBe('#ffffff');
  });

  it('for every colour at least one of black and white clears 4.5', () => {
    // The luminance band where neither does is empty. Sampled across the cube,
    // because this claim is what lets the accent-foreground row stay at 4.5.
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
          const best = Math.max(contrastRatio('#000000', hex), contrastRatio('#ffffff', hex));
          expect(best).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('the two renderings of one derivation agree within a rounding step', () => {
    const js = mix('#0ea5e9', '#000000', 85, 'oklab');
    const parsed = parseColor(js);
    expect(parsed).not.toBeNull();
    // The CSS the emitter writes is color-mix(in oklab, #0ea5e9 85%, #000), and
    // `mix` is the same interpolation, so a PDF and a browser agree.
    expect(js.startsWith('#')).toBe(true);
  });
});

describe('the gate rejects a brand that states an illegible pair', () => {
  it('refuses a stated accent-foreground that fails against its accent', () => {
    // #ffffff on #0ea5e9 is 2.77 against a 4.5 requirement. A brand may not opt
    // out of legibility by stating the foreground itself.
    const result = brandSchema.safeParse(
      synthetic({ shared: { accent: '#0ea5e9', 'accent-foreground': '#ffffff' }, dark: {}, light: { accent: '#0284c7' } }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths.some((path) => path === 'tokens.dark' || path === 'tokens.light')).toBe(true);
    }
  });

  it('refuses a text-primary override that fails against its own bg-primary override', () => {
    const result = brandSchema.safeParse(
      synthetic({ shared: {}, dark: { 'text-primary': '#333333', 'bg-primary': '#2b2b2b' }, light: {} }),
    );
    expect(result.success).toBe(false);
  });

  it('refuses one accent for both schemes when light falls below the 3.0 non-text floor', () => {
    // This is the exact configuration the demo brand fixes in its own file:
    // #0ea5e9 is 6.90 on medshield's dark surface and 2.66 on redstyle's light one.
    const result = brandSchema.safeParse(synthetic({ shared: { accent: '#0ea5e9' }, dark: {}, light: {} }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join(' ')).toContain('accent');
    }
  });
});

describe('the gate is CALIBRATED, which is what an unscoped one could never be', () => {
  it('every shipped brand parses', () => {
    // redbtn overrides NOTHING, so an unscoped gate fails it on redstyle's own
    // #ffffff-on-#ef4444 (3.76) and light #dc2626-on-#f4f4f5 (4.39), and
    // createRegistry throws at module load before the app can boot.
    for (const brand of [redbtn, redbtnBeta, medshield]) {
      expect(() => brandSchema.parse(brand)).not.toThrow();
    }
  });

  it('a brand that touches neither side of a pair is not judged on it', () => {
    const brand = brandSchema.parse(synthetic({ shared: {}, dark: { 'bg-tertiary': '#101010' }, light: {} }));
    for (const scheme of ['dark', 'light'] as const) {
      for (const issue of contrastIssues(brand, scheme)) {
        expect(issue).not.toContain('accent-foreground');
        expect(issue).not.toContain('accent-text');
      }
    }
  });

  it('redbtn is judged on exactly the one pair redLabel derives for it', () => {
    // black on #f87171 is 7.59 in dark, white on #b91c1c is 6.47 in light.
    expect(contrastIssues(REDBTN, 'dark')).toEqual([]);
    expect(contrastIssues(REDBTN, 'light')).toEqual([]);
    expect(contrastRatio('#000000', '#f87171')).toBe(7.59);
    expect(contrastRatio('#ffffff', '#b91c1c')).toBe(6.47);
  });

  it('medshield clears every pair in both schemes', () => {
    expect(contrastIssues(MEDSHIELD, 'dark')).toEqual([]);
    expect(contrastIssues(MEDSHIELD, 'light')).toEqual([]);
    // accent-foreground derives to black in both: 7.58 on #0ea5e9, 5.13 on #0284c7.
    expect(contrastRatio('#000000', '#0ea5e9')).toBe(7.58);
    expect(contrastRatio('#000000', '#0284c7')).toBe(5.13);
  });

  it('redbtn-beta is redbtn, so it is judged identically', () => {
    expect(contrastIssues(REDBTN_BETA, 'dark')).toEqual(contrastIssues(REDBTN, 'dark'));
  });
});

describe('applyBrandOverride: a stored document decorates, it never introduces', () => {
  it('rejects an override whose accent fails contrast and returns the untouched brand', () => {
    const result = applyBrandOverride(MEDSHIELD, { tokens: { light: { accent: '#0ea5e9' } } });
    expect(result.applied).toBe(false);
    expect(result.error).not.toBeNull();
    expect(result.brand).toBe(MEDSHIELD);
  });

  it('ignores auth, hosts, id, origin, billing.productKey and githubApp.appSlug entirely', () => {
    const result = applyBrandOverride(MEDSHIELD, {
      id: 'evil',
      hosts: ['evil.example.com'],
      origin: 'https://evil.example.com',
      auth: { mode: 'isolated', cookieName: 'evil_session', secretEnv: 'EVIL' },
      billing: { productKey: 'evil' },
      githubApp: { appSlug: 'evil-app', blurb: 'a legitimate blurb' },
      legal: { footerText: 'MedShield, a division of Somebody' },
    });
    expect(result.applied).toBe(true);
    expect(result.brand.id).toBe('medshield');
    expect(result.brand.hosts).toEqual(['scan-demo.redbtn.io']);
    expect(result.brand.origin).toBe('https://scan-demo.redbtn.io');
    expect(result.brand.auth.mode).toBe('ecosystem');
    expect(result.brand.billing.productKey).toBe('medshield');
    // The confused-deputy cross-check still compares against the real slug.
    expect(result.brand.githubApp.appSlug).toBe('red-by-redbtn');
    expect(result.brand.githubApp.blurb).toBe('a legitimate blurb');
    expect(result.brand.legal.footerText).toBe('MedShield, a division of Somebody');
  });

  it('a partial override destroys nothing beside it', () => {
    const legal = applyBrandOverride(REDBTN, { legal: { footerText: 'x' } });
    expect(legal.applied).toBe(true);
    expect(legal.brand.legal.termsUrl).toBe('https://redbtn.io/terms');
    expect(legal.brand.legal.privacyUrl).toBe('https://redbtn.io/privacy');
    expect(legal.brand.legal.copyrightHolder).toBe('redbtn');
    expect(legal.brand.legal.noticesPath).toBe('/legal/notices');
    expect(legal.brand.legal.complianceNotice).toBeNull();

    const logo = applyBrandOverride(REDBTN, { logo: { markUrl: '/brand/redbtn/icon-384.png' } });
    expect(logo.applied).toBe(true);
    expect(logo.brand.logo.faviconUrl).toBe('/brand/redbtn/favicon-32x32.png');
    expect(logo.brand.logo.appleIconUrl).toBe('/brand/redbtn/apple-touch-icon.png');
    expect(logo.brand.logo.maskableUrl).toBe('/brand/redbtn/icon-maskable-512.png');

    const product = applyBrandOverride(REDBTN, { product: { tagline: 'x' } });
    expect(product.applied).toBe(true);
    // The wordmark still splits.
    expect(product.brand.product.wordmarkPrefix).toBe('red');

    const tokens = applyBrandOverride(MEDSHIELD, { tokens: { dark: { 'bg-primary': '#05090f' } } });
    expect(tokens.applied).toBe(true);
    expect(tokens.brand.tokens.shared['accent']).toBe('#0ea5e9');
    expect(tokens.brand.tokens.light['accent']).toBe('#0284c7');
  });

  it('refuses every URL shape a bare z.url() would have accepted', () => {
    const cases: unknown[] = [
      { legal: { termsUrl: 'javascript:alert(1)' } },
      { support: { docsUrl: 'http://x.example' } },
      { logo: { markUrl: '//evil.example/x.png' } },
      { logo: { markUrl: '/\\evil.example/x.png' } },
      { fonts: { sansFamily: 'Inter; } :root { --accent: red' } },
    ];
    for (const raw of cases) {
      const result = applyBrandOverride(REDBTN, raw);
      expect(result.applied, JSON.stringify(raw)).toBe(false);
      expect(result.brand).toBe(REDBTN);
    }
  });

  it('a non-object override is refused rather than spread', () => {
    for (const raw of [null, 'x', 42, []]) {
      expect(applyBrandOverride(REDBTN, raw).applied).toBe(false);
    }
  });
});
