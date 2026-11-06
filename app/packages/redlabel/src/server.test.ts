import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Section 10.1's preview rows and the store seam.
 *
 * `next/headers` is mocked rather than reached: `cookies()` and `headers()` throw
 * outside a request, and the rule for this package is that every test is pure, so
 * the request surface is a fixture. Nothing here touches a network, a database or
 * a file.
 */
const cookieJar = new Map<string, string>();
const headerJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () => ({ get: (name: string) => headerJar.get(name.toLowerCase()) ?? null }),
}));

const { medshield } = await import('./brands/medshield');
const { redbtn } = await import('./brands/redbtn');
const { redbtnBeta } = await import('./brands/redbtn-beta');
const { createRegistry } = await import('./resolve');
const { configureBrand, getBrand, getBrandWith, readBrandHost } = await import('./server');

const REGISTRY = createRegistry({
  brands: [redbtn, redbtnBeta, medshield],
  defaultBrandId: 'redbtn',
});

/** An isolated brand, so a preview of it would change sign-in behaviour if it could. */
const ISOLATED_REGISTRY = createRegistry({
  brands: [
    redbtn,
    medshield,
    {
      ...medshield,
      id: 'isolated-demo',
      hosts: ['scan.isolated.example'],
      origin: 'https://scan.isolated.example',
      auth: { mode: 'isolated', cookieName: 'isolated_session', secretEnv: 'ISOLATED_JWT_SECRET' },
    },
  ],
  defaultBrandId: 'redbtn',
});

beforeEach(() => {
  cookieJar.clear();
  headerJar.clear();
  delete process.env['REDLABEL_PREVIEW'];
});

afterEach(() => {
  delete process.env['REDLABEL_PREVIEW'];
});

describe('readBrandHost', () => {
  it('prefers x-forwarded-host, which redrouter-proxy overwrites with the host it routed on', () => {
    headerJar.set('host', 'container.internal');
    headerJar.set('x-forwarded-host', 'scan-demo.redbtn.io');
    return expect(readBrandHost()).resolves.toBe('scan-demo.redbtn.io');
  });

  it('falls back to host, and normalizes both', async () => {
    headerJar.set('host', 'SCAN-DEMO.redbtn.io:8443');
    expect(await readBrandHost()).toBe('scan-demo.redbtn.io');
  });

  it('a forged host no brand claims is simply the default, because the registry IS the allowlist', async () => {
    headerJar.set('host', 'evil.example');
    configureBrand({ registry: REGISTRY });
    expect((await getBrandWith({ registry: REGISTRY, host: 'evil.example' })).id).toBe('redbtn');
  });
});

describe('the preview toggle needs all three conditions', () => {
  const allow = () => true;

  it('is denied when REDLABEL_PREVIEW is unset', async () => {
    cookieJar.set('redlabel_preview', 'medshield');
    const brand = await getBrandWith({ registry: REGISTRY, host: 'scan.redbtn.io', allowPreview: allow });
    expect(brand.id).toBe('redbtn');
  });

  it('is denied when the app says this actor may not preview', async () => {
    process.env['REDLABEL_PREVIEW'] = '1';
    cookieJar.set('redlabel_preview', 'medshield');
    const brand = await getBrandWith({
      registry: REGISTRY,
      host: 'scan.redbtn.io',
      allowPreview: () => false,
    });
    expect(brand.id).toBe('redbtn');
  });

  it('is denied for an id that is not in the registry', async () => {
    process.env['REDLABEL_PREVIEW'] = '1';
    cookieJar.set('redlabel_preview', 'not-a-brand');
    const brand = await getBrandWith({ registry: REGISTRY, host: 'scan.redbtn.io', allowPreview: allow });
    expect(brand.id).toBe('redbtn');
  });

  it('is allowed with all three, and the cookie is the only channel', async () => {
    process.env['REDLABEL_PREVIEW'] = '1';
    cookieJar.set('redlabel_preview', 'medshield');
    const brand = await getBrandWith({ registry: REGISTRY, host: 'scan.redbtn.io', allowPreview: allow });
    expect(brand.id).toBe('medshield');
    expect(brand.product.short).toBe('MedShield');
  });

  it("a previewed brand's auth is forced back to the HOST brand's, in every allowed case", async () => {
    // Presentation only. Previewing an isolated brand on an ecosystem deployment
    // must not change the sign-in redirect or the cookie the container verifies.
    process.env['REDLABEL_PREVIEW'] = '1';
    cookieJar.set('redlabel_preview', 'isolated-demo');
    const brand = await getBrandWith({
      registry: ISOLATED_REGISTRY,
      host: 'scan.redbtn.io',
      allowPreview: allow,
    });
    expect(brand.id).toBe('isolated-demo');
    expect(brand.auth).toEqual((ISOLATED_REGISTRY.brands['redbtn'] as { auth: unknown }).auth);
    expect(brand.auth.mode).toBe('ecosystem');
  });
});

describe('the store DECORATES a brand the registry resolved; it never introduces one', () => {
  it('applies a valid override on top of the static brand', async () => {
    const brand = await getBrandWith({
      registry: REGISTRY,
      host: 'scan-demo.redbtn.io',
      store: { byId: async (id) => (id === 'medshield' ? { legal: { footerText: 'Assured' } } : null) },
    });
    expect(brand.id).toBe('medshield');
    expect(brand.legal.footerText).toBe('Assured');
    // Everything else survives, which the Raw schemas exist for.
    expect(brand.legal.companyName).toBe('MedShield');
    expect(brand.legal.noticesPath).toBe('/legal/notices');
  });

  it('is keyed on the brand the REGISTRY chose, never on anything request controlled', async () => {
    const seen: string[] = [];
    await getBrandWith({
      registry: REGISTRY,
      host: 'evil.example',
      store: {
        byId: async (id) => {
          seen.push(id);
          return null;
        },
      },
    });
    expect(seen).toEqual(['redbtn']);
  });

  it('a rejected override never takes a page down and never disables the contrast gate', async () => {
    const warnings: Array<Record<string, unknown> | undefined> = [];
    const brand = await getBrandWith({
      registry: REGISTRY,
      host: 'scan-demo.redbtn.io',
      store: { byId: async () => ({ tokens: { light: { accent: '#0ea5e9' } } }) },
      logger: { warn: (_message, meta) => warnings.push(meta) },
    });
    expect(brand.tokens.light['accent']).toBe('#0284c7');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.['brandId']).toBe('medshield');
  });

  it('a store that throws is a brand that still renders', async () => {
    const brand = await getBrandWith({
      registry: REGISTRY,
      host: 'scan-demo.redbtn.io',
      store: {
        byId: async () => {
          throw new Error('mongo is down');
        },
      },
    });
    expect(brand.id).toBe('medshield');
  });
});

describe('the auth-plan refusal is a SIGNAL, logged once, never keyed on a host', () => {
  it('warns through the app logger and serves the deployment brand', async () => {
    const messages: string[] = [];
    const metas: Array<Record<string, unknown> | undefined> = [];
    const logger = {
      warn: (message: string, meta?: Record<string, unknown>) => {
        messages.push(message);
        metas.push(meta);
      },
    };
    const brand = await getBrandWith({
      registry: ISOLATED_REGISTRY,
      host: 'scan.isolated.example',
      logger,
    });
    expect(brand.id).toBe('redbtn');
    expect(messages[0]).toContain('auth plan differs');
    expect(metas[0]).toEqual({ refused: 'isolated-demo', served: 'redbtn' });
    // Deduped on a CLOSED set of brand ids, so a forged Host header cannot grow
    // module-level state on every request.
    await getBrandWith({ registry: ISOLATED_REGISTRY, host: 'scan.isolated.example', logger });
    expect(messages).toHaveLength(1);
  });
});

describe('configureBrand', () => {
  it('getBrand() throws with a fix-it message before the app registers its registry', async () => {
    vi.resetModules();
    const fresh = await import('./server');
    headerJar.set('host', 'scan.redbtn.io');
    await expect(fresh.getBrand()).rejects.toThrow(/configureBrand/);
  });

  it('refuses a call with no registry, rather than replacing "unconfigured" with "broken"', () => {
    expect(() => configureBrand(undefined as unknown as Parameters<typeof configureBrand>[0])).toThrow(
      /configureBrand/,
    );
    expect(() => configureBrand({} as Parameters<typeof configureBrand>[0])).toThrow(/registry/);
  });

  it('getBrand takes zero arguments, so one request is one cache entry and one store read', () => {
    // React's cache() keys on ARGUMENT IDENTITY, so getBrand({store}) written
    // with a fresh object literal in four places is four store reads.
    expect(getBrand.length).toBe(0);
  });

  it('resolves through the registered sources once configured', async () => {
    configureBrand({ registry: REGISTRY });
    headerJar.set('host', 'scan-demo.redbtn.io');
    expect((await getBrand()).id).toBe('medshield');
  });
});
