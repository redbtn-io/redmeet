import { describe, expect, it } from 'vitest';

import { brandSchema, originSchema, type BrandInput } from './brand';
import { redbtn } from './brands/redbtn';
import { redbtnBeta } from './brands/redbtn-beta';
import { contrastIssues } from './color';
import { brandEmailBranding, authPlan, signInUrl } from './auth';
import { exportIdentity } from './export';
import { splitWordmark } from './wordmark';
import { DEFAULT_VOCABULARY, VOCABULARY_KEYS, t, titleCase } from './vocabulary';
import { brandMetadata, brandIcons, brandManifest, brandViewport } from './next';
import lock from '../brand-icons.lock.json' with { type: 'json' };

/** Section 10.6's schema rows, for the two brands this slice ships. */

function withTokens(tokens: BrandInput['tokens']): unknown {
  return { ...redbtn, id: 'fixture-brand', tokens };
}

describe('the shipped brands parse', () => {
  it('redbtn and redbtn-beta both parse, which is the gate calibration', () => {
    // An UNSCOPED contrast gate fails `redbtn`, which overrides nothing, on
    // redstyle's own `#ffffff` on `#ef4444` (3.76) and light `#dc2626` on
    // `#f4f4f5` (4.39), and `createRegistry` then throws at module load before
    // the app can boot.
    expect(() => brandSchema.parse(redbtn)).not.toThrow();
    expect(() => brandSchema.parse(redbtnBeta)).not.toThrow();
  });

  it('the gate is scoped: a brand that touches only an untouched pair has no issues', () => {
    const brand = brandSchema.parse(withTokens({ shared: { 'bg-tertiary': '#222222' }, dark: {}, light: {} }));
    expect(contrastIssues(brand, 'dark')).toEqual([]);
    expect(contrastIssues(brand, 'light')).toEqual([]);
  });
});

describe('the contrast gate refuses what redLabel is answerable for', () => {
  it('refuses a stated accent-foreground that is illegible on the stated accent', () => {
    // `#ffffff` on `#0ea5e9` is 2.77 against a 4.5 requirement. A brand may not
    // opt out of legibility by stating the foreground itself.
    const result = brandSchema.safeParse(
      withTokens({ shared: { accent: '#0ea5e9', 'accent-foreground': '#ffffff' }, dark: {}, light: {} }),
    );
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths.some((path) => path === 'tokens.dark' || path === 'tokens.light')).toBe(true);
  });

  it('refuses an accent that fails the non-text floor in light, with no light override', () => {
    // `#0ea5e9` reads 2.66 on redstyle's light `bg-primary`, below the 3.0 floor.
    const result = brandSchema.safeParse(withTokens({ shared: { accent: '#0ea5e9' }, dark: {}, light: {} }));
    expect(result.success).toBe(false);
  });

  it('refuses a text-primary override that fails against a bg-primary override', () => {
    const result = brandSchema.safeParse(
      withTokens({ shared: {}, dark: { 'bg-primary': '#07101a', 'text-primary': '#16202b' }, light: {} }),
    );
    expect(result.success).toBe(false);
  });
});

describe('the ecosystem host guard is the accounts predicate, not a lookalike', () => {
  const ecosystemAt = (origin: string, hosts: string[]): unknown => ({ ...redbtn, origin, hosts });

  it('refuses an ecosystem brand on a non-redbtn.io host', () => {
    const result = brandSchema.safeParse(ecosystemAt('https://scan.medshield.io', ['scan.medshield.io']));
    expect(result.success).toBe(false);
    const message = result.success ? '' : JSON.stringify(result.error.issues);
    expect(message).toContain('accounts');
  });

  it('refuses the two lookalikes accounts own comment names', () => {
    expect(brandSchema.safeParse(ecosystemAt('https://notredbtn.io', ['notredbtn.io'])).success).toBe(false);
    expect(
      brandSchema.safeParse(
        ecosystemAt('https://redbtn.io.attacker.example', ['redbtn.io.attacker.example']),
      ).success,
    ).toBe(false);
  });

  it('accepts a legitimate port, which the old .host check rejected', () => {
    expect(
      brandSchema.safeParse(ecosystemAt('https://scan.redbtn.io:8443', ['scan.redbtn.io'])).success,
    ).toBe(true);
  });

  it('refuses an isolated brand carrying the shared cookie domain', () => {
    const result = brandSchema.safeParse({
      ...redbtn,
      auth: { mode: 'isolated', cookieName: 'x_session', cookieDomain: '.redbtn.io', secretEnv: 'X_JWT_SECRET' },
    });
    expect(result.success).toBe(false);
  });

  it('refuses hosts: ["localhost"], on the host schema and on the ecosystem rule', () => {
    expect(brandSchema.safeParse({ ...redbtn, hosts: ['localhost'] }).success).toBe(false);
  });

  it('accepts the same token declared in shared and in one scheme', () => {
    expect(
      brandSchema.safeParse(withTokens({ shared: { accent: '#0284c7' }, dark: { accent: '#0ea5e9' }, light: {} }))
        .success,
    ).toBe(true);
  });
});

describe('no bare z.url() survives', () => {
  const bad = [
    'javascript:alert(1)',
    'data:text/html,x',
    'ftp://a.b',
    'http://evil.example',
    'https://scan.redbtn.io/',
    'https://scan.redbtn.io/app',
    'https://scan.redbtn.io?x=1',
    'https://scan.redbtn.io#x',
  ];
  for (const value of bad) {
    it(`originSchema refuses ${value}`, () => {
      expect(originSchema.safeParse(value).success).toBe(false);
    });
  }

  it('accountsUrl is a frozen literal', () => {
    const result = brandSchema.safeParse({
      ...redbtn,
      auth: { mode: 'ecosystem', accountsUrl: 'http://accounts.redbtn.io' },
    });
    expect(result.success).toBe(false);
  });

  it('an asset ref cannot be protocol relative or backslash relative', () => {
    expect(
      brandSchema.safeParse({ ...redbtn, logo: { ...redbtn.logo, markUrl: '//evil.example/x.png' } }).success,
    ).toBe(false);
    expect(
      brandSchema.safeParse({ ...redbtn, logo: { ...redbtn.logo, markUrl: '/\\evil.example/x.png' } }).success,
    ).toBe(false);
  });

  it('a font family list cannot close the declaration', () => {
    expect(
      brandSchema.safeParse({
        ...redbtn,
        fonts: { sansHref: null, monoHref: null, sansFamily: 'Inter; } :root { --accent: red', monoFamily: null },
      }).success,
    ).toBe(false);
  });
});

describe('auth, export, vocabulary and the wordmark', () => {
  const brand = brandSchema.parse(redbtn);
  const beta = brandSchema.parse(redbtnBeta);

  it('authPlan widens the ecosystem branch without inventing a value', () => {
    expect(authPlan(brand)).toEqual({
      mode: 'ecosystem',
      cookieName: 'red_session',
      cookieDomain: '.redbtn.io',
      accountsUrl: 'https://accounts.redbtn.io',
      secretEnv: 'JWT_SECRET',
    });
  });

  it('signInUrl builds the return URL from the brand origin and sanitizes next', () => {
    expect(signInUrl(brand, '/overview')).toBe(
      'https://accounts.redbtn.io/?next=' + encodeURIComponent('https://scan.redbtn.io/overview'),
    );
    for (const hostile of ['//evil.example', '/\\evil.example', 'https://evil.example', '/x\u0000y']) {
      expect(signInUrl(brand, hostile)).toBe(
        'https://accounts.redbtn.io/?next=' + encodeURIComponent('https://scan.redbtn.io/'),
      );
    }
    // Beta returns to beta, which is the whole reason it is its own brand.
    expect(signInUrl(beta, '/overview')).toContain(encodeURIComponent('https://scan-beta.redbtn.io/overview'));
  });

  it('brandEmailBranding is total, so redauth never falls back to its own copyright', () => {
    for (const candidate of [brand, beta]) {
      const branding = brandEmailBranding(candidate);
      expect(typeof branding.footerText).toBe('string');
      expect(branding.footerText).not.toBe('');
    }
    const noFooter = brandSchema.parse({ ...redbtn, email: { ...redbtn.email, footerText: null } });
    const synthesized = brandEmailBranding(noFooter).footerText ?? '';
    expect(synthesized).toContain('All rights reserved');
    expect(synthesized).toContain('redbtn');
    expect(synthesized).not.toContain('RedBtn');
  });

  it('exportIdentity resolves the notices URL on the brand origin', () => {
    expect(exportIdentity(brand)).toMatchObject({
      toolName: 'redScan',
      organization: 'redbtn',
      filenamePrefix: 'redscan',
      noticesUrl: 'https://scan.redbtn.io/legal/notices',
    });
    expect(exportIdentity(beta).filenamePrefix).toBe('redscan-beta');
    expect(exportIdentity(beta).noticesUrl).toBe('https://scan-beta.redbtn.io/legal/notices');
  });

  it('the vocabulary defaults are exactly the key set, both directions', () => {
    expect(Object.keys(DEFAULT_VOCABULARY).sort()).toEqual([...VOCABULARY_KEYS].sort());
    expect(t(brand, 'apiKey')).toBe('CI key');
    expect(t(brand, 'sbom')).toBe('SBOM');
    const renamed = brandSchema.parse({
      ...redbtn,
      product: { ...redbtn.product, vocabulary: { finding: 'observation' } },
    });
    expect(t(renamed, 'finding')).toBe('observation');
    expect(t(renamed, 'findings')).toBe('findings');
  });

  it('titleCase leaves an all-caps term alone', () => {
    expect(titleCase('scan')).toBe('Scan');
    expect(titleCase('SBOM')).toBe('SBOM');
  });

  it('splitWordmark splits only when the brand states a prefix', () => {
    expect(splitWordmark('redScan', 'red')).toEqual({ prefix: 'red', suffix: 'scan' });
    expect(splitWordmark('redScan', null)).toEqual({ plain: 'redScan' });
    expect(splitWordmark('medShield', null)).toEqual({ plain: 'medShield' });
    expect(splitWordmark('MedShield Code Assurance', null)).toEqual({ plain: 'MedShield Code Assurance' });
    expect(splitWordmark('medShield', 'red')).toEqual({ plain: 'medShield' });
  });
});

describe('the next helpers', () => {
  const brand = brandSchema.parse(redbtn);

  it('never emits black-translucent', () => {
    expect(JSON.stringify(brandMetadata(brand))).not.toContain('black-translucent');
    expect(brandMetadata(brand).appleWebApp).toMatchObject({ statusBarStyle: 'default' });
  });

  it('emits no icon URL outside /brand/<id>/', () => {
    for (const match of JSON.stringify(brandIcons(brand)).matchAll(/"url":"([^"]+)"/g)) {
      expect(match[1]).toMatch(/^\/brand\/redbtn\//);
    }
  });

  it('manifest icon sizes equal the dimensions recorded in the lock', () => {
    const entries = lock as Record<string, { width: number; height: number }>;
    for (const icon of brandManifest(brand).icons ?? []) {
      const key = String(icon.src).replace(/^\/brand\//, '');
      const recorded = entries[key];
      expect(recorded, `${key} is missing from brand-icons.lock.json`).toBeDefined();
      expect(icon.sizes).toBe(`${recorded?.width}x${recorded?.height}`);
    }
  });

  it('viewport carries exactly two media-scoped theme colours and viewportFit cover', () => {
    const viewport = brandViewport(brand);
    expect(viewport.viewportFit).toBe('cover');
    expect(Array.isArray(viewport.themeColor)).toBe(true);
    const colors = viewport.themeColor as Array<{ media: string; color: string }>;
    expect(colors).toHaveLength(2);
    expect(colors[0]?.media).toBe('(prefers-color-scheme: dark)');
    expect(colors[1]?.media).toBe('(prefers-color-scheme: light)');
    expect(colors[0]?.color).toBe('#0a0a0a');
    expect(colors[1]?.color).toBe('#fafafa');
  });
});
