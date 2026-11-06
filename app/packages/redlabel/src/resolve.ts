/**
 * Host to brand, and the deployment's own identity.
 *
 * Resolution is TOTAL: it returns a `Brand`, never null, never throws. An
 * unknown host is not an error, it is the default face, and that is the whole
 * local-development story too: `localhost` matches no brand, falls to rule 3 and
 * renders the deployment brand, through the same code path production uses for
 * an unknown host.
 *
 * **`.` does no logging, ever.** Deduping a warning per host would need
 * module-level state keyed by an attacker-supplied `Host` header, in every
 * runtime that imports `.`, including the edge gate, which calls `resolveBrand`
 * on every request. So `.` RETURNS the signal (`authMismatch`) and `./server`
 * emits it through the app's logger, deduped on a closed set of brand ids.
 */
import { brandSchema, type Brand, type BrandId } from './brand';
import { authPlan } from './auth';

export interface BrandRegistry {
  readonly brands: Readonly<Record<BrandId, Brand>>;
  readonly defaultBrandId: BrandId;
  /** Exact host claims. */
  readonly byHost: ReadonlyMap<string, Brand>;
  /** Suffix claims, keyed with a leading dot. */
  readonly bySuffix: ReadonlyMap<string, Brand>;
  readonly ids: readonly BrandId[];
}

/**
 * Take the first comma-separated value, trim, lowercase, strip a trailing dot,
 * strip `:port` (only when the tail after the last colon is all digits, so an
 * unbracketed IPv6 string normalizes to '' rather than to a truncated host), and
 * return '' for anything containing a slash, an at sign, whitespace or a control
 * character.
 */
export function normalizeHost(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  const first = raw.split(',')[0] ?? '';
  let host = first.trim().toLowerCase();
  if (host === '') return '';
  if (/[/@\s\u0000-\u001f\u007f]/.test(host)) return '';
  // A bracketed IPv6 literal, with or without a port, is not a brand host.
  if (host.startsWith('[')) return '';
  const colon = host.lastIndexOf(':');
  if (colon >= 0) {
    const tail = host.slice(colon + 1);
    if (!/^\d+$/.test(tail)) return '';
    host = host.slice(0, colon);
    // An unbracketed IPv6 literal still holds a colon after the "port" came
    // off, and it must normalize to '' rather than to a truncated host.
    if (host.includes(':')) return '';
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host === '') return '';
  return host;
}

export interface BrandResolution {
  brand: Brand;
  source: 'exact' | 'suffix' | 'default';
  /** The brand rule 4 refused to serve, or null. The SIGNAL, not a log line. */
  authMismatch: BrandId | null;
}

function authPlansMatch(a: Brand, b: Brand): boolean {
  const left = authPlan(a);
  const right = authPlan(b);
  return (
    left.mode === right.mode &&
    left.cookieName === right.cookieName &&
    left.cookieDomain === right.cookieDomain &&
    left.accountsUrl === right.accountsUrl &&
    left.secretEnv === right.secretEnv
  );
}

export function resolveBrandResult(
  host: string | null | undefined,
  registry: BrandRegistry,
): BrandResolution {
  const fallback = deploymentBrand(registry);
  const normalized = normalizeHost(host);

  let found: Brand | undefined;
  let source: BrandResolution['source'] = 'default';

  if (normalized !== '') {
    found = registry.byHost.get(normalized);
    if (found) source = 'exact';
    if (!found) {
      // Walk the label boundaries from the longest suffix down, so the longest
      // match wins by construction. A suffix entry carries a leading dot and
      // never matches the bare apex: `.medshield.io` claims `scan.medshield.io`
      // but not `medshield.io`, which must be listed explicitly.
      const labels = normalized.split('.');
      for (let i = 1; i < labels.length; i += 1) {
        const candidate = `.${labels.slice(i).join('.')}`;
        const match = registry.bySuffix.get(candidate);
        if (match) {
          found = match;
          source = 'suffix';
          break;
        }
      }
    }
  }

  if (!found) return { brand: fallback, source: 'default', authMismatch: null };

  // Rule 4, SYMMETRIC. A resolved brand is served only when its auth plan is
  // equal, field for field, to the deployment brand's. The likelier failure is
  // an ecosystem-default deployment resolving an isolated brand whose secretEnv
  // does not exist in that container, so `process.env[plan.secretEnv]` is
  // undefined and the auth factory is handed an undefined signing key. Equality
  // in both directions costs the same one conditional and closes both.
  if (!authPlansMatch(found, fallback)) {
    return { brand: fallback, source: 'default', authMismatch: found.id };
  }

  return { brand: found, source, authMismatch: null };
}

/** The thin wrapper every ordinary caller uses. */
export function resolveBrand(host: string | null | undefined, registry: BrandRegistry): Brand {
  return resolveBrandResult(host, registry).brand;
}

/* --------------------------------------------------------------- registry -- */

export interface CreateRegistryInput {
  brands: unknown[];
  defaultBrandId: string;
}

/** Copy the entry with `email.appName` defaulted from `product.name`. */
function withEmailAppName(entry: unknown): unknown {
  if (entry === null || typeof entry !== 'object') return entry;
  const record = entry as Record<string, unknown>;
  const email = record['email'];
  const product = record['product'];
  if (email === null || typeof email !== 'object') return entry;
  if ((email as Record<string, unknown>)['appName'] !== undefined) return entry;
  const name =
    product !== null && typeof product === 'object'
      ? (product as Record<string, unknown>)['name']
      : undefined;
  if (typeof name !== 'string') return entry;
  return { ...record, email: { ...(email as Record<string, unknown>), appName: name } };
}

/**
 * Parse, cross-check and index every brand. It runs at module load in
 * `./brands`, so a bad registry is a BUILD failure and never a runtime surprise.
 * It reads no environment: env belongs to `./brands`, the one entry allowed to
 * touch it.
 */
export function createRegistry(input: CreateRegistryInput): BrandRegistry {
  const brands: Record<string, Brand> = {};
  const byHost = new Map<string, Brand>();
  const bySuffix = new Map<string, Brand>();
  const ids: string[] = [];

  input.brands.forEach((entry, index) => {
    const declaredId =
      entry !== null && typeof entry === 'object' && 'id' in entry
        ? String((entry as { id: unknown }).id)
        : '(no id)';
    // `email.appName` is filled from `product.name` BEFORE parsing, so the
    // schema can keep it required (it is what redauth puts in the From header
    // and in the body, and `undefined` there is redbtn's fallback reaching a
    // reseller's users) while a brand file states only what differs.
    const raw = withEmailAppName(entry);
    const parsed = brandSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `redlabel: brand at index ${index} ("${declaredId}") is invalid: ${JSON.stringify(
          parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        )}`,
      );
    }
    const brand = parsed.data;
    if (brands[brand.id] !== undefined) {
      throw new Error(`redlabel: duplicate brand id "${brand.id}" at index ${index}.`);
    }

    const originHost = new URL(brand.origin).hostname;
    for (const host of brand.hosts) {
      const bare = host.startsWith('.') ? host.slice(1) : host;
      // ONE BRAND MAY NOT CLAIM TWO ENVIRONMENTS. `origin` is the sign-in
      // `?next=` base, `metadataBase`, the OG image base and the email logo
      // base, so a brand claiming both production and beta while carrying one
      // origin makes signing in on beta return the user to production.
      if (bare !== originHost && !bare.endsWith(`.${originHost}`)) {
        throw new Error(
          `redlabel: brand "${brand.id}" claims host "${host}", which is outside its own origin ` +
            `"${brand.origin}" (host "${originHost}"). A brand claims one environment.`,
        );
      }
      if (host.startsWith('.')) {
        if (bySuffix.has(host)) {
          throw new Error(`redlabel: suffix "${host}" is claimed twice (brand "${brand.id}").`);
        }
        bySuffix.set(host, brand);
      } else {
        if (byHost.has(host)) {
          throw new Error(`redlabel: host "${host}" is claimed twice (brand "${brand.id}").`);
        }
        byHost.set(host, brand);
      }
    }

    brands[brand.id] = brand;
    ids.push(brand.id);
  });

  // An exact host that a DIFFERENT brand already claims as a suffix is
  // ambiguous to a reader even though rule 1 resolves it.
  for (const [host, owner] of byHost) {
    for (const [suffix, claimant] of bySuffix) {
      if (claimant.id === owner.id) continue;
      if (host === suffix.slice(1) || host.endsWith(suffix)) {
        throw new Error(
          `redlabel: host "${host}" (brand "${owner.id}") sits inside suffix claim "${suffix}" ` +
            `(brand "${claimant.id}").`,
        );
      }
    }
  }

  if (brands[input.defaultBrandId] === undefined) {
    throw new Error(
      `redlabel: defaultBrandId "${input.defaultBrandId}" is not in the registry. ` +
        `Known ids: ${ids.join(', ')}.`,
    );
  }

  // Reseller parents: a dangling parent, a self-parent and a cycle are all
  // configuration bugs that would otherwise surface as a missing "Powered by".
  for (const brand of Object.values(brands)) {
    if (brand.reseller === null) continue;
    const seen = new Set<string>([brand.id]);
    let current: Brand | undefined = brand;
    while (current?.reseller) {
      const parentId: string = current.reseller.parentBrandId;
      if (parentId === current.id) {
        throw new Error(`redlabel: brand "${current.id}" names itself as its reseller parent.`);
      }
      const parent: Brand | undefined = brands[parentId];
      if (parent === undefined) {
        throw new Error(
          `redlabel: brand "${current.id}" names reseller parent "${parentId}", which is not in the registry.`,
        );
      }
      if (seen.has(parentId)) {
        throw new Error(`redlabel: reseller parent cycle through "${parentId}".`);
      }
      seen.add(parentId);
      current = parent;
    }
  }

  // Fill what a brand file may leave out, so it states only what differs.
  for (const brand of Object.values(brands)) {
    if (brand.export.toolName === undefined) brand.export.toolName = brand.product.name;
    if (brand.export.toolInformationUri === undefined) brand.export.toolInformationUri = brand.origin;
    if (brand.export.organization === undefined) brand.export.organization = brand.legal.companyName;
  }

  return {
    brands: Object.freeze(brands),
    defaultBrandId: input.defaultBrandId,
    byHost,
    bySuffix,
    ids: Object.freeze(ids),
  };
}

/* ------------------------------------------------------- deployment brand -- */

/** The brand this deployment IS. Pure, so the edge gate can read it. */
export function deploymentBrand(registry: BrandRegistry): Brand {
  return registry.brands[registry.defaultBrandId] as Brand;
}

export function brandById(registry: BrandRegistry, id: string | null | undefined): Brand | null {
  if (typeof id !== 'string' || id === '') return null;
  return registry.brands[id] ?? null;
}

/**
 * The brand of an ORG, for anything durable or out of request: email,
 * notifications, exports, artifact filenames, scheduled reports, the evidence
 * pack. Host resolution paints the current request and nothing else.
 *
 * It tolerates an unknown id rather than assuming the registry contains it,
 * because redLabel validates a `BrandId` with `brandIdSchema` while the app
 * stores it as a plain string, so a brand can be deleted from the registry while
 * org rows still name it. It never throws and never logs; a caller that wants
 * the signal uses `brandById`.
 */
export function brandForOrg(registry: BrandRegistry, brandId: string | null | undefined): Brand {
  return brandById(registry, brandId) ?? deploymentBrand(registry);
}

/**
 * The deployment must NAME itself.
 *
 * An unset `REDMEET_DEFAULT_BRAND_ID` is caught here rather than inside
 * `deploymentBrandId()`, for the same reason `assertDeploymentAuth` is not
 * called at module load: `./brands` is evaluated during `next build`, when
 * RedRun's runtime env does not exist yet, so a module-load throw is a red
 * Docker build rather than a caught misconfiguration. The `?? 'redbtn'` fallback
 * in `deploymentBrandId()` exists to let the build evaluate the module and for
 * nothing else.
 */
export function assertDeploymentBrand(env: Record<string, string | undefined>): void {
  const value = (env['REDMEET_DEFAULT_BRAND_ID'] ?? '').trim();
  if (value === '') {
    throw new Error(
      'REDMEET_DEFAULT_BRAND_ID is not set. It names the brand this deployment IS, and the brand ' +
        'names the auth mode, the cookie, the cookie domain, the accounts URL and the secret ' +
        'together. Without it a reseller container boots as redbtn.',
    );
  }
}

/**
 * The deployment's secret exists, the optional mode cross-check agrees, and the
 * sender domain is one this transport may send for.
 *
 * `brandEmailConfig` splices a brand-chosen envelope From onto the deployment's
 * credentials, and nothing in the schema can know whether that pairing is valid.
 * A reseller brand sending as its own domain while the container holds redbtn's
 * SMTP credentials fails SPF and DKIM alignment, so its magic-link email is
 * quarantined, and on an isolated deployment the magic link is the ONLY way in.
 * The failure is silent and total, so this fails CLOSED at boot instead.
 */
export function assertDeploymentAuth(
  registry: BrandRegistry,
  env: Record<string, string | undefined>,
): void {
  const brand = deploymentBrand(registry);
  const plan = authPlan(brand);

  const secret = (env[plan.secretEnv] ?? '').trim();
  if (secret === '') {
    throw new Error(
      `${plan.secretEnv} is not set. The deployment brand "${brand.id}" names it as its session ` +
        'verify key, so this container would verify every session against undefined.',
    );
  }

  const declaredMode = (env['REDMEET_AUTH_MODE'] ?? '').trim();
  if (declaredMode !== '' && declaredMode !== plan.mode) {
    throw new Error(
      `REDMEET_AUTH_MODE is "${declaredMode}" but brand "${brand.id}" is "${plan.mode}". ` +
        'Two variables can never be allowed to disagree in a running container.',
    );
  }

  const domains = (env['SMTP_SENDING_DOMAINS'] ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  if (domains.length > 0) {
    const sender = brand.email.fromAddress.split('@')[1]?.toLowerCase() ?? '';
    if (!domains.includes(sender)) {
      throw new Error(
        `Brand "${brand.id}" sends as "${brand.email.fromAddress}" but SMTP_SENDING_DOMAINS does ` +
          `not list "${sender}". That pairing fails SPF and DKIM alignment silently.`,
      );
    }
  }
}
