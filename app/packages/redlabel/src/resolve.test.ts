import { describe, expect, it, vi } from 'vitest';

import { brandSchema, type BrandInput } from './brand';
import {
  assertDeploymentAuth,
  assertDeploymentBrand,
  brandById,
  brandForOrg,
  createRegistry,
  deploymentBrand,
  normalizeHost,
  resolveBrand,
  resolveBrandResult,
} from './resolve';
import { medshield } from './brands/medshield';
import { redbtn } from './brands/redbtn';
import { redbtnBeta } from './brands/redbtn-beta';

/**
 * Section 10.1. One fixture registry, one table, and the failure cases for
 * `createRegistry`. Nothing here reads a path outside the package.
 *
 * The ids are `brand-a`, `brand-b` and `brand-deep` rather than the spec table's
 * `a`, `b` and `deep`: `brandIdSchema` requires at least three characters,
 * because a brand id lands in a CSS selector, a DOM attribute and an object key.
 * The hosts are the table's.
 */

function fixture(
  overrides: Partial<BrandInput> & { id: string; origin: string; hosts: string[] },
): BrandInput {
  return {
    product: { name: overrides.id, short: overrides.id.slice(0, 12) },
    logo: { markUrl: '/brand/x/icon-192.png', masterUrl: '/brand/x/logo.png' },
    legal: { companyName: overrides.id },
    support: { email: 'support@example.com' },
    email: { accentColor: '#ef4444', fromAddress: 'noreply@example.com' },
    auth: { mode: 'isolated', cookieName: 'x_session', secretEnv: 'X_JWT_SECRET' },
    features: {
      sast: true, sca: true, secrets: true, sbom: true, aiTriage: true, aiFix: true,
      githubConnect: true, zipUpload: true, schedules: true, ciKeys: true,
      billing: false, notifications: true,
    },
    ...overrides,
  } as BrandInput;
}

const brandA = fixture({
  id: 'brand-a',
  origin: 'https://a.example.com',
  hosts: ['a.example.com', '.a.example.com'],
});
const brandB = fixture({ id: 'brand-b', origin: 'https://b.example.com', hosts: ['b.example.com'] });
const brandDeep = fixture({
  id: 'brand-deep',
  origin: 'https://eu.a.example.com',
  hosts: ['.eu.a.example.com'],
});

const registry = createRegistry({
  brands: [brandA, brandB, brandDeep],
  defaultBrandId: 'brand-a',
});

describe('normalizeHost', () => {
  const cases: Array<[string | null | undefined, string]> = [
    ['a.example.com', 'a.example.com'],
    ['A.Example.COM', 'a.example.com'],
    ['a.example.com:3000', 'a.example.com'],
    ['a.example.com.', 'a.example.com'],
    ['a.example.com, evil.com', 'a.example.com'],
    ['evil.com/../a.example.com', ''],
    ['user@evil.com', ''],
    ['[::1]:3000', ''],
    ['::1', ''],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ];
  for (const [input, expected] of cases) {
    it(`normalizes ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, () => {
      expect(normalizeHost(input)).toBe(expected);
    });
  }
});

describe('resolveBrand', () => {
  const table: Array<[string | null | undefined, string, 'exact' | 'suffix' | 'default']> = [
    ['a.example.com', 'brand-a', 'exact'],
    ['A.Example.COM', 'brand-a', 'exact'],
    ['a.example.com:3000', 'brand-a', 'exact'],
    ['a.example.com.', 'brand-a', 'exact'],
    ['a.example.com, evil.com', 'brand-a', 'exact'],
    ['x.a.example.com', 'brand-a', 'suffix'],
    ['x.eu.a.example.com', 'brand-deep', 'suffix'],
    ['b.example.com', 'brand-b', 'exact'],
    ['unknown.test', 'brand-a', 'default'],
    ['', 'brand-a', 'default'],
    [null, 'brand-a', 'default'],
    [undefined, 'brand-a', 'default'],
    ['evil.com/../a.example.com', 'brand-a', 'default'],
    ['[::1]:3000', 'brand-a', 'default'],
    ['localhost', 'brand-a', 'default'],
    ['localhost:3000', 'brand-a', 'default'],
  ];
  for (const [host, expectedId, expectedSource] of table) {
    it(`${JSON.stringify(host)} resolves to ${expectedId} (${expectedSource})`, () => {
      const result = resolveBrandResult(host, registry);
      expect(result.brand.id).toBe(expectedId);
      expect(result.source).toBe(expectedSource);
      expect(result.authMismatch).toBeNull();
    });
  }

  it('the longest suffix wins, which is what puts x.eu.a.example.com on brand-deep', () => {
    // `.eu.a.example.com` and `.a.example.com` both match; the walk starts at the
    // longest suffix, so the deeper claim is found first.
    expect(resolveBrand('x.eu.a.example.com', registry).id).toBe('brand-deep');
    expect(resolveBrand('x.a.example.com', registry).id).toBe('brand-a');
  });

  it('a leading-dot suffix claim never matches its own apex', () => {
    const suffixOnly = createRegistry({
      brands: [fixture({ id: 'brand-apex', origin: 'https://a.io', hosts: ['.a.io'] }), brandB],
      defaultBrandId: 'brand-b',
    });
    expect(resolveBrand('a.io', suffixOnly).id).toBe('brand-b');
    expect(resolveBrand('x.a.io', suffixOnly).id).toBe('brand-apex');
  });

  it('the auth-isolation guard is symmetric, and the inverse direction is the one that happens', () => {
    // An ecosystem default resolving an ISOLATED brand: `process.env[secretEnv]`
    // would be undefined in that container and the auth factory would be handed
    // an undefined signing key. Nothing downstream catches that.
    const iso = fixture({
      id: 'brand-iso',
      origin: 'https://iso.example.com',
      hosts: ['iso.example.com'],
    });
    const ecosystemDefault = createRegistry({ brands: [redbtn, iso], defaultBrandId: 'redbtn' });
    const refused = resolveBrandResult('iso.example.com', ecosystemDefault);
    expect(refused.brand.id).toBe('redbtn');
    expect(refused.source).toBe('default');
    expect(refused.authMismatch).toBe('brand-iso');

    // And the other direction, which an earlier one-way guard covered.
    const isolatedDefault = createRegistry({ brands: [redbtn, iso], defaultBrandId: 'brand-iso' });
    const refusedBack = resolveBrandResult('scan.redbtn.io', isolatedDefault);
    expect(refusedBack.brand.id).toBe('brand-iso');
    expect(refusedBack.authMismatch).toBe('redbtn');

    // Equal auth plans are served, so the guard is not a blanket "always default".
    expect(resolveBrandResult('b.example.com', registry).brand.id).toBe('brand-b');
  });

  it('performs no console IO', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    resolveBrandResult('unknown.test', registry);
    resolveBrandResult('a.example.com', registry);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
    log.mockRestore();
  });
});

describe('createRegistry failure cases', () => {
  it('rejects a duplicate id', () => {
    expect(() => createRegistry({ brands: [brandA, brandA], defaultBrandId: 'brand-a' })).toThrow(
      /duplicate brand id/,
    );
  });

  it('rejects a duplicate exact host', () => {
    const clash = fixture({
      id: 'brand-clash',
      origin: 'https://a.example.com',
      hosts: ['a.example.com'],
    });
    expect(() => createRegistry({ brands: [brandA, clash], defaultBrandId: 'brand-a' })).toThrow(
      /claimed twice/,
    );
  });

  it('rejects an exact host inside another brand suffix claim', () => {
    const inside = fixture({
      id: 'brand-inside',
      origin: 'https://x.a.example.com',
      hosts: ['x.a.example.com'],
    });
    expect(() => createRegistry({ brands: [brandA, inside], defaultBrandId: 'brand-a' })).toThrow(
      /sits inside suffix claim/,
    );
  });

  it('rejects a missing default, naming the ids that exist', () => {
    expect(() => createRegistry({ brands: [brandA], defaultBrandId: 'nope' })).toThrow(
      /not in the registry.*Known ids: brand-a/s,
    );
  });

  it('rejects a dangling reseller parent', () => {
    const dangling = fixture({
      id: 'brand-dangling',
      origin: 'https://d.example.com',
      hosts: ['d.example.com'],
      reseller: { parentBrandId: 'brand-ghost' },
    });
    expect(() => createRegistry({ brands: [brandA, dangling], defaultBrandId: 'brand-a' })).toThrow(
      /names reseller parent "brand-ghost", which is not in the registry/,
    );
  });

  it('rejects a self parent', () => {
    const self = fixture({
      id: 'brand-self',
      origin: 'https://s.example.com',
      hosts: ['s.example.com'],
      reseller: { parentBrandId: 'brand-self' },
    });
    expect(() => createRegistry({ brands: [brandA, self], defaultBrandId: 'brand-a' })).toThrow(
      /names itself/,
    );
  });

  it('rejects a two-brand parent cycle', () => {
    const one = fixture({
      id: 'brand-one',
      origin: 'https://one.example.com',
      hosts: ['one.example.com'],
      reseller: { parentBrandId: 'brand-two' },
    });
    const two = fixture({
      id: 'brand-two',
      origin: 'https://two.example.com',
      hosts: ['two.example.com'],
      reseller: { parentBrandId: 'brand-one' },
    });
    expect(() => createRegistry({ brands: [one, two], defaultBrandId: 'brand-one' })).toThrow(/cycle/);
  });

  it('rejects a brand whose hosts leave its own origin, which is the 9.2 configuration', () => {
    // `{origin: 'https://scan.redbtn.io', hosts: ['scan.redbtn.io', 'scan-beta.redbtn.io']}`
    // is exactly what made signing in on beta return the user to production and
    // beta's magic-link emails point at production assets.
    const twoEnvironments = { ...redbtn, hosts: ['scan.redbtn.io', 'scan-beta.redbtn.io'] };
    expect(() => createRegistry({ brands: [twoEnvironments], defaultBrandId: 'redbtn' })).toThrow(
      /claims host "scan-beta\.redbtn\.io", which is outside its own origin "https:\/\/scan\.redbtn\.io"/,
    );
  });
});

describe('the shipped registry', () => {
  const shipped = createRegistry({ brands: [redbtn, redbtnBeta], defaultBrandId: 'redbtn' });

  it('parses both brands and indexes their hosts', () => {
    expect(shipped.ids).toEqual(['redbtn', 'redbtn-beta']);
    expect(resolveBrand('scan.redbtn.io', shipped).id).toBe('redbtn');
    expect(resolveBrand('scan-beta.redbtn.io', shipped).id).toBe('redbtn-beta');
  });

  it('fills export identity from the product, the origin and the company', () => {
    const brand = shipped.brands['redbtn'];
    expect(brand?.export.toolName).toBe('redScan');
    expect(brand?.export.toolInformationUri).toBe('https://scan.redbtn.io');
    expect(brand?.export.organization).toBe('redbtn');
  });

  it('brandById and brandForOrg tolerate an unknown id without throwing', () => {
    expect(brandById(shipped, 'redbtn-beta')?.id).toBe('redbtn-beta');
    expect(brandById(shipped, null)).toBeNull();
    expect(brandById(shipped, undefined)).toBeNull();
    expect(brandById(shipped, 'x'.repeat(64))).toBeNull();
    expect(brandForOrg(shipped, 'redbtn-beta').id).toBe('redbtn-beta');
    expect(brandForOrg(shipped, null).id).toBe('redbtn');
    expect(brandForOrg(shipped, undefined).id).toBe('redbtn');
    expect(brandForOrg(shipped, 'x'.repeat(64)).id).toBe('redbtn');
  });

  it('deploymentBrand is the default brand', () => {
    expect(deploymentBrand(shipped).id).toBe('redbtn');
    const beta = createRegistry({ brands: [redbtn, redbtnBeta], defaultBrandId: 'redbtn-beta' });
    expect(deploymentBrand(beta).id).toBe('redbtn-beta');
  });

  it('names the known ids when the default brand id is a typo', () => {
    expect(() =>
      createRegistry({ brands: [redbtn, redbtnBeta], defaultBrandId: 'redbtnbeta' }),
    ).toThrow(/Known ids: redbtn, redbtn-beta/);
  });
});

describe('the registry this repo actually ships', () => {
  const shipped = createRegistry({ brands: [redbtn, redbtnBeta, medshield], defaultBrandId: 'redbtn' });

  it('every brand in REGISTRY parses, asserted per brand so a failure names it', () => {
    for (const [id, brand] of Object.entries(shipped.brands)) {
      expect(() => brandSchema.parse(brand), id).not.toThrow();
      expect(brand.id).toBe(id);
    }
    expect(shipped.ids).toEqual(['redbtn', 'redbtn-beta', 'medshield']);
  });

  it('one deployment serves two brands, which is what proves the seam in production', () => {
    // scan-demo.redbtn.io is one label under the wildcard: no DNS record, no TLS
    // work, an appConfig.customDomains entry on the existing workspace.
    expect(resolveBrand('scan.redbtn.io', shipped).id).toBe('redbtn');
    expect(resolveBrand('scan-demo.redbtn.io', shipped).id).toBe('medshield');
    expect(resolveBrandResult('scan-demo.redbtn.io', shipped).source).toBe('exact');
    expect(resolveBrandResult('scan-demo.redbtn.io', shipped).authMismatch).toBeNull();
  });

  it('the demo brand is served because its auth plan EQUALS the deployment brand’s', () => {
    // Both are ecosystem on *.redbtn.io, so rule 4 lets it through. The moment
    // medshield moves to its own domain it becomes isolated, and then it is its
    // own workspace rather than a second brand on this one.
    expect(medshield.auth.mode).toBe('ecosystem');
    expect(resolveBrandResult('scan-demo.redbtn.io', shipped).brand.auth.mode).toBe('ecosystem');
  });

  it('an unknown host is the deployment brand, through the same path production uses', () => {
    expect(resolveBrand('localhost', shipped).id).toBe('redbtn');
    expect(resolveBrand('scan-demo.redbtn.io.attacker.example', shipped).id).toBe('redbtn');
  });

  it('a reseller workspace boots as its own brand from one variable', () => {
    const reseller = createRegistry({
      brands: [redbtn, redbtnBeta, medshield],
      defaultBrandId: 'medshield',
    });
    expect(deploymentBrand(reseller).id).toBe('medshield');
    expect(resolveBrand('unknown.example', reseller).id).toBe('medshield');
  });
});

describe('the deployment assertions', () => {
  const shipped = createRegistry({ brands: [redbtn, redbtnBeta], defaultBrandId: 'redbtn' });

  it('assertDeploymentBrand throws on an unset or empty variable and returns on a set one', () => {
    expect(() => assertDeploymentBrand({})).toThrow(/REDMEET_DEFAULT_BRAND_ID/);
    expect(() => assertDeploymentBrand({ REDMEET_DEFAULT_BRAND_ID: '  ' })).toThrow(
      /REDMEET_DEFAULT_BRAND_ID/,
    );
    expect(() => assertDeploymentBrand({ REDMEET_DEFAULT_BRAND_ID: 'redbtn' })).not.toThrow();
  });

  it('assertDeploymentAuth checks the secret, the optional mode and the sending domain', () => {
    expect(() => assertDeploymentAuth(shipped, {})).toThrow(/JWT_SECRET is not set/);
    expect(() => assertDeploymentAuth(shipped, { JWT_SECRET: 's' })).not.toThrow();
    expect(() =>
      assertDeploymentAuth(shipped, { JWT_SECRET: 's', REDMEET_AUTH_MODE: 'isolated' }),
    ).toThrow(/REDMEET_AUTH_MODE is "isolated"/);
    expect(() =>
      assertDeploymentAuth(shipped, { JWT_SECRET: 's', REDMEET_AUTH_MODE: 'ecosystem' }),
    ).not.toThrow();
    expect(() =>
      assertDeploymentAuth(shipped, { JWT_SECRET: 's', SMTP_SENDING_DOMAINS: 'example.com' }),
    ).toThrow(/SMTP_SENDING_DOMAINS does not list "redbtn.io"/);
    expect(() =>
      assertDeploymentAuth(shipped, {
        JWT_SECRET: 's',
        SMTP_SENDING_DOMAINS: 'redbtn.io,scan.redbtn.io',
      }),
    ).not.toThrow();
  });
});
