import 'server-only';

/**
 * Request-scoped brand resolution, and the optional Mongo decoration.
 *
 * `import 'server-only'` is the enforcement behind the 1.3 boundary table, not a
 * comment: a client-graph import of this module is a build error in every
 * consuming app, including a second product that inherits none of this repo's
 * scripts. Middleware, the proxy, route handlers and server components are
 * unaffected, because `server-only` fails only in the browser condition.
 *
 * `.` does no IO, so every warning this package produces is emitted HERE,
 * through the app's logger seam, deduped on a closed set of brand ids and never
 * on an attacker-supplied host.
 */
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { z } from 'zod';

import {
  brandExportSchemaRaw,
  brandFontsSchemaRaw,
  brandGithubAppSchemaRaw,
  brandLegalSchemaRaw,
  brandResellerSchemaRaw,
  brandSchema,
  brandSupportSchemaRaw,
  brandTokensSchemaRaw,
  brandEmailSchemaRaw,
  logoSchemaRaw,
  productSchemaRaw,
  type Brand,
} from './brand';
import { FEATURE_KEYS } from './features';
import { normalizeHost, resolveBrandResult, type BrandRegistry } from './resolve';

/**
 * The WHOLE store port.
 *
 * **The store may only DECORATE a brand the static registry already resolved. It
 * may never introduce one.** That is why there is no `byHost`: a host-keyed
 * store would let a database row claim a host the registry never gave it, which
 * breaks the invariant that the registry is the host allowlist, leaves no
 * defined base brand to merge onto, and turns a forgeable header into a
 * per-request store key, so every request with a novel `Host` is a cache miss
 * and a database read.
 */
export interface BrandStore {
  /** The raw stored document, or null. redLabel validates it; the store never does. */
  byId(id: string): Promise<unknown | null>;
}

/**
 * Only these paths may come from the store. `auth`, `hosts`, `id`, `origin`,
 * `billing.productKey` and `githubApp.appSlug` are deployment and security facts
 * baked into the container's env and its DNS: a database write must not be able
 * to change the cookie name, the accounts URL, the Stripe product, the set of
 * hosts a brand claims, or the App slug the confused-deputy cross-check compares
 * against.
 *
 * Each leaf is the NO-DEFAULTS variant of its schema, and that is load bearing.
 * On zod 4 `.partial()` does NOT suppress `.default()`, so with the defaulted
 * schemas a stored `{legal: {footerText: 'x'}}` NULLED `termsUrl`,
 * `privacyUrl`, `copyrightHolder`, `noticesPath` and `complianceNotice`, and a
 * stored `{product: {tagline: 'x'}}` nulled `wordmarkPrefix` and silently
 * un-split the wordmark.
 */
export const brandStoreOverrideSchema = z.object({
  product: productSchemaRaw.partial().optional(),
  logo: logoSchemaRaw.partial().optional(),
  tokens: brandTokensSchemaRaw.partial().optional(),
  fonts: brandFontsSchemaRaw.partial().optional(),
  legal: brandLegalSchemaRaw.partial().optional(),
  support: brandSupportSchemaRaw.partial().optional(),
  email: brandEmailSchemaRaw
    .pick({ accentColor: true, logoUrl: true, logoWidth: true, footerText: true })
    .partial()
    .optional(),
  export: brandExportSchemaRaw.partial().optional(),
  features: z.partialRecord(z.enum(FEATURE_KEYS), z.boolean()).optional(),
  /** Copy only. `appSlug` is the confused-deputy cross-check's other side. */
  githubApp: brandGithubAppSchemaRaw.pick({ blurb: true }).partial().optional(),
  reseller: brandResellerSchemaRaw.optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merge ONLY the keys physically present in the RAW document, tested with
 * `Object.hasOwn` against the raw object at each level, never against the parsed
 * result. Parsing validates; the raw document decides what was written. Without
 * this, a schema that grows a default later reintroduces the same silent
 * destruction the Raw schemas exist to stop.
 */
function mergePresent(base: unknown, raw: unknown, depth: number): unknown {
  if (!isRecord(base) || !isRecord(raw)) return raw;
  if (depth === 0) return raw;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(raw, key)) continue;
    out[key] = mergePresent(base[key], raw[key], depth - 1);
  }
  return out;
}

/**
 * A malformed brand document never takes a page down and never disables the
 * contrast gate: on any failure the untouched static brand comes back with an
 * error string the caller logs.
 */
export function applyBrandOverride(
  base: Brand,
  raw: unknown,
): { brand: Brand; applied: boolean; error: string | null } {
  const parsed = brandStoreOverrideSchema.safeParse(raw);
  if (!parsed.success) {
    return { brand: base, applied: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  if (!isRecord(raw)) return { brand: base, applied: false, error: 'override is not an object' };

  const merged: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(raw, key)) continue;
    if (!Object.hasOwn(parsed.data, key)) continue;
    // `tokens` merges PER SCHEME and `product.vocabulary` and `features` merge
    // key by key, so an override that touches `dark` leaves `shared` and `light`
    // intact and a brand keeps its accent and its whole derived family.
    const depth = key === 'tokens' || key === 'product' ? 2 : 1;
    merged[key] = mergePresent(merged[key], (parsed.data as Record<string, unknown>)[key], depth);
  }

  // Re-parse the RESULT with the full schema, so the contrast gate, the
  // ecosystem-host rule and every URL constraint apply to the merged brand too,
  // and the defaults the Raw schemas dropped are restored exactly once, from the
  // merged values.
  const result = brandSchema.safeParse(merged);
  if (!result.success) {
    return {
      brand: base,
      applied: false,
      error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  return { brand: result.data, applied: true, error: null };
}

/* ------------------------------------------------------------- resolution -- */

export interface BrandSources {
  registry: BrandRegistry;
  store?: BrandStore | null;
  /** The app proves the actor may preview. redLabel never decides who an admin is. */
  allowPreview?: () => boolean | Promise<boolean>;
  /** The app's logger. Absent means silent, never `console`. */
  logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

let sources: BrandSources | null = null;
const warned = new Set<string>();

/**
 * Called once, from the app's server-only brand module. Reads no env, performs
 * no IO.
 *
 * A missing registry is refused HERE rather than at the first request. Without
 * the guard, `configureBrand(undefined)` (a module that exported nothing, a
 * bundler condition that resolved the wrong file) silently replaces the
 * "not configured" state with a broken one, and the fix-it message below is then
 * never the error anybody sees.
 */
export function configureBrand(next: BrandSources): void {
  if (!next || !next.registry) {
    throw new Error(
      'redlabel: configureBrand({ registry }) was called without a registry. The app registers ' +
        'its registry once, at module scope, in its own server-only brand module.',
    );
  }
  sources = next;
  warned.clear();
}

function requireSources(): BrandSources {
  if (sources === null) {
    throw new Error(
      'redlabel: configureBrand({ registry }) has not been called. The app registers its registry ' +
        'once, at module scope, in its own server-only brand module.',
    );
  }
  return sources;
}

/**
 * The request host.
 *
 * `x-forwarded-host` then `host`, first comma-separated value each.
 * redrouter-proxy OVERWRITES `x-forwarded-host` with the host it actually routed
 * on and deletes the RFC 7239 `Forwarded` header, and it creates its proxy
 * without `changeOrigin`, so the original `Host` also arrives unchanged. Both
 * remain forgeable by a peer that reaches the container directly on the docker
 * network, which is safe here because THE REGISTRY IS THE ALLOWLIST: a forged
 * host no brand claims resolves to the default, and nothing in `Brand` is an
 * authority.
 */
export async function readBrandHost(): Promise<string> {
  const headerList = await headers();
  return normalizeHost(headerList.get('x-forwarded-host') ?? headerList.get('host'));
}

async function resolve(options: BrandSources & { host?: string }): Promise<Brand> {
  const host = options.host ?? (await readBrandHost());
  const resolution = resolveBrandResult(host, options.registry);
  let brand = resolution.brand;

  // Preview, for a platform admin, on a deployment that allows it. All three
  // conditions, and the store is not consulted for a preview id. The cookie is
  // the only channel: a query string reaches only a page's `searchParams` prop,
  // which a layout or a nested server component cannot read.
  if (process.env['REDLABEL_PREVIEW'] === '1' && options.allowPreview) {
    const allowed = await options.allowPreview();
    if (allowed) {
      const cookieStore = await cookies();
      const requested = cookieStore.get('redlabel_preview')?.value;
      const candidate = requested ? options.registry.brands[requested] : undefined;
      if (candidate) {
        // Presentation only: the resolved `auth` is forced back to the real host
        // brand's, so previewing an isolated brand on an ecosystem deployment
        // cannot change sign-in behaviour.
        brand = { ...candidate, auth: brand.auth };
      }
    }
  }

  if (options.store) {
    // Keyed on the brand the REGISTRY already chose, never on anything
    // request-controlled.
    const raw = await options.store.byId(brand.id).catch(() => null);
    if (raw !== null && raw !== undefined) {
      const applied = applyBrandOverride(brand, raw);
      if (applied.applied) brand = applied.brand;
      else options.logger?.warn('redlabel: brand override rejected', { brandId: brand.id, error: applied.error });
    }
  }

  if (resolution.authMismatch !== null && !warned.has(resolution.authMismatch)) {
    warned.add(resolution.authMismatch);
    options.logger?.warn('redlabel: brand refused, auth plan differs from the deployment brand', {
      refused: resolution.authMismatch,
      served: brand.id,
    });
  }

  return brand;
}

/**
 * ZERO arguments, on purpose.
 *
 * React's `cache()` keys on ARGUMENT IDENTITY, so `getBrand({ store })` written
 * with a fresh object literal in a layout and in three server components is four
 * cache misses and four store reads. Sources are registered once at module
 * scope; the per-request function has an empty argument list and therefore
 * exactly one cache entry per request.
 */
export const getBrand: () => Promise<Brand> = cache(async (): Promise<Brand> => resolve(requireSources()));

/** The escape hatch: explicit, uncached, so nobody reaches for it in a page. */
export async function getBrandWith(options: BrandSources & { host?: string }): Promise<Brand> {
  return resolve(options);
}
