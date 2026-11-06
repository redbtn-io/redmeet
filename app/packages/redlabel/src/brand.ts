/**
 * The `Brand` record.
 *
 * Every optional field has a concrete default or is `.nullable().default(null)`,
 * so a parsed `Brand` has exactly one shape and UI code never writes
 * `brand.legal?.footerText ?? ''`.
 *
 * **Everything in `Brand` is presentation, packaging or a NAME of something
 * else. Nothing in it is a secret, a credential, an org id or an authority.**
 * That is the invariant that lets a brand be resolved from an
 * attacker-controlled request header.
 *
 * Each leaf ships twice: the ordinary schema with its defaults, and a `Raw`
 * variant with every `.default(...)` removed. The Raw variants are what the
 * Mongo override schema is built from (section 3.5), and they are load bearing
 * rather than tidiness: on zod 4 `.partial()` does NOT suppress `.default()`, so
 * with the defaulted schemas a stored `{legal: {footerText: 'x'}}` NULLED
 * `termsUrl`, `privacyUrl`, `copyrightHolder`, `noticesPath` and
 * `complianceNotice`.
 */
import { z } from 'zod';

import { isParseableColor, contrastIssues } from './color';
import { FEATURE_KEYS } from './features';
import { tokenNameSchema } from './tokens';
import { VOCABULARY_KEYS } from './vocabulary';

/* --------------------------------------------------------- leaf schemas -- */

/**
 * Lowercase kebab id. It appears in a CSS selector, a DOM attribute and an
 * object key, so it is restricted to characters that are safe in all three
 * without escaping. In particular it can carry neither a quote nor a backslash,
 * so `[data-brand="<id>"]` cannot be escaped out of.
 */
export const brandIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/);
export type BrandId = z.infer<typeof brandIdSchema>;

/**
 * A host this brand claims. Exact (`scan.redbtn.io`) or a suffix claim
 * (`.medshield.io`, leading dot). Lowercase, no scheme, no port, no path, no
 * trailing dot, no wildcard character.
 */
export const brandHostSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(/^\.?(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/);

/**
 * Every URL bearing field goes through this or through something built on it.
 * There is no bare `z.url()` anywhere in the record: on zod 4 a bare `z.url()`
 * accepts `javascript:alert(1)`, `data:text/html,x`, `ftp://a.b` and
 * `http://evil.example`, and a brand is parseable from a Mongo document, where
 * `legal.termsUrl` and `support.docsUrl` render as `href` and `fonts.*Href`
 * renders as `<link rel="stylesheet">`.
 */
export const httpsUrlSchema = z.url({ protocol: /^https$/ }).max(500);

/**
 * `Brand.origin`. Stricter than `httpsUrlSchema` because `origin` is
 * CONCATENATED (`${brand.origin}/signin?next=`) and resolved against
 * (`new URL(path, brand.origin)`), so a trailing slash yields `//signin` and a
 * path, query or fragment silently changes both.
 */
export const originSchema = httpsUrlSchema.refine((value) => {
  const url = new URL(value);
  return url.pathname === '/' && !value.endsWith('/') && !url.search && !url.hash;
}, 'origin must be scheme and host only, with no trailing slash, path, query or fragment');

/**
 * A root relative path with no host, resolved against `brand.origin` at the call
 * site and never used bare. The negative lookahead is the same anti-`//host`
 * guard `assetRefSchema` carries.
 */
export const rootPathSchema = z
  .string()
  .max(200)
  .regex(
    /^\/(?![/\\])[A-Za-z0-9\-._~/]*(#[A-Za-z0-9\-._~]+)?$/,
    'expected a single-slash root-relative path',
  );

/**
 * An asset reference: a root relative path this app serves, or an absolute https
 * URL. Never a filesystem path: `output: 'standalone'` traces modules, not
 * files.
 *
 * The negative lookahead is load bearing: `'//evil.example/x.png'.startsWith('/')`
 * is TRUE, so the naive check turned "a path this app serves" into a
 * protocol-relative cross-origin fetch, and `/\evil.example` is the backslash
 * variant some URL parsers normalize the same way.
 */
export const assetRefSchema = z.union([
  z.string().max(500).regex(/^\/(?![/\\])[^\s"'<>\\]*$/, 'expected a single-slash root-relative path'),
  httpsUrlSchema,
]);

/**
 * A CSS colour redLabel is willing to reason about. Deliberately NOT
 * `color-mix()` or `var()`: every brand colour must be resolvable to RGBA so the
 * contrast gate and the email and PDF palettes can be computed. Derived tokens
 * redLabel EMITS may use color-mix; brand INPUT may not.
 */
export const cssColorSchema = z.string().max(64).refine(isParseableColor, 'unparseable color');

/* ---------------------------------------------------------------- product -- */

export const productSchemaRaw = z.object({
  /** Full product name, as data. The wordmark split is presentation. */
  name: z.string().min(1).max(60),
  /** Short form for tight chrome and the PWA `short_name`. Max 12 so Android does not truncate it. */
  short: z.string().min(1).max(12),
  tagline: z.string().max(120).nullable(),
  /**
   * The wordmark split prefix. `null` means this brand's name is never split.
   * It defaults to null, not to 'red': a whitelabel library must not carry
   * redbtn's own prefix as the behaviour every adopter inherits.
   */
  wordmarkPrefix: z.string().regex(/^[a-z][a-z0-9]{1,11}$/).nullable(),
  /** Overrides on top of DEFAULT_VOCABULARY. Partial by construction. */
  vocabulary: z.partialRecord(z.enum(VOCABULARY_KEYS), z.string().min(1).max(40)),
});

export const productSchema = z.object({
  ...productSchemaRaw.shape,
  tagline: productSchemaRaw.shape.tagline.default(null),
  wordmarkPrefix: productSchemaRaw.shape.wordmarkPrefix.default(null),
  vocabulary: productSchemaRaw.shape.vocabulary.default({}),
});

/* ------------------------------------------------------------------- logo -- */

export const logoSchemaRaw = z.object({
  /**
   * The square mark. Drawn at 16 to 40 px in chrome, so it points at the 192 px
   * icon, never the 1024 px master: 18 KB against 244 KB for a 28 px disc.
   */
  markUrl: assetRefSchema,
  /** The 1024 px master, used by the manifest and by anything that rasterizes. */
  masterUrl: assetRefSchema,
  /** Optional horizontal lockup. When present, `Wordmark` renders it instead of the split text. */
  wordmarkUrl: assetRefSchema.nullable(),
  faviconUrl: assetRefSchema.nullable(),
  appleIconUrl: assetRefSchema.nullable(),
  maskableUrl: assetRefSchema.nullable(),
  /**
   * Intrinsic square size of `markUrl` in px. It documents which committed file
   * `markUrl` points at and the aspect ratio; `<BrandMark>` renders a plain
   * `<img>` and takes its rendered size from its `size` prop.
   */
  markSize: z.number().int().min(16).max(1024),
  /**
   * The redbtn disc gets a brand glow in the shell. A flat reseller logo must
   * not, or it looks like a rendering bug. Off by default.
   */
  glow: z.boolean(),
  /** Alt text for the mark when it stands alone. */
  alt: z.string().max(120),
});

export const logoSchema = z.object({
  ...logoSchemaRaw.shape,
  wordmarkUrl: logoSchemaRaw.shape.wordmarkUrl.default(null),
  faviconUrl: logoSchemaRaw.shape.faviconUrl.default(null),
  appleIconUrl: logoSchemaRaw.shape.appleIconUrl.default(null),
  maskableUrl: logoSchemaRaw.shape.maskableUrl.default(null),
  markSize: logoSchemaRaw.shape.markSize.default(192),
  glow: logoSchemaRaw.shape.glow.default(false),
  alt: logoSchemaRaw.shape.alt.default(''),
});

/* ----------------------------------------------------------------- tokens -- */

const tokenOverridesSchemaRaw = z.partialRecord(tokenNameSchema, cssColorSchema);
const tokenOverridesSchema = tokenOverridesSchemaRaw.default({});

/**
 * `shared` is a BASE LAYER, not a separate emission target. A scheme's declared
 * palette is `{...shared, ...tokens[scheme]}`, so `shared: {accent: X}, light:
 * {accent: Y}` reads exactly as it looks. Which declaration ends up in the style
 * attribute and which ends up in `ThemeStyle` is decided by the emitter,
 * mechanically, from the two resolved palettes.
 */
export const brandTokensSchemaRaw = z.object({
  shared: tokenOverridesSchemaRaw,
  dark: tokenOverridesSchemaRaw,
  light: tokenOverridesSchemaRaw,
});

export const brandTokensSchema = z
  .object({
    shared: tokenOverridesSchema,
    dark: tokenOverridesSchema,
    light: tokenOverridesSchema,
  })
  .default({ shared: {}, dark: {}, light: {} });

/* ------------------------------------------------------ fonts, legal, support -- */

/**
 * A CSS font-family LIST. Deliberately narrow, because this string is
 * interpolated into a style attribute: no `;`, `{`, `}`, `(`, `)` or `url`, so a
 * brand document cannot close the declaration and open another. It must end in a
 * generic family, so a blocked font CDN degrades to system sans, not serif.
 */
const fontFamilyListSchema = z
  .string()
  .max(200)
  .regex(
    /^(?:"[A-Za-z0-9 _-]{1,40}"|[A-Za-z][A-Za-z0-9-]{0,39})(?:\s*,\s*(?:"[A-Za-z0-9 _-]{1,40}"|[A-Za-z][A-Za-z0-9-]{0,39}))*$/,
  )
  .refine(
    (value) =>
      /(?:^|,)\s*(?:ui-)?(?:sans-serif|serif|monospace|system-ui|ui-monospace|ui-sans-serif|ui-serif)\s*$/.test(
        value,
      ),
    'the stack must end in a generic family, so a blocked font CDN degrades to system sans, not serif',
  );

export const brandFontsSchemaRaw = z.object({
  /**
   * A stylesheet the app puts in `<head>`: Google Fonts, or a self hosted file
   * under `/brand/<id>/fonts.css`. It is the @font-face SOURCE only.
   */
  sansHref: httpsUrlSchema.nullable(),
  monoHref: httpsUrlSchema.nullable(),
  /**
   * The family stack redLabel points redstyle's `--font-geist-sans` and
   * `--font-geist-mono` at. It names a FAMILY, never a CSS variable: a Google
   * Fonts stylesheet declares @font-face rules and a family name and declares no
   * custom property, so `--font-geist-sans: var(--font-inter)` resolves to
   * nothing and every surface falls back to the browser's default serif.
   */
  sansFamily: fontFamilyListSchema.nullable(),
  monoFamily: fontFamilyListSchema.nullable(),
});

export const brandFontsSchema = z
  .object({
    sansHref: brandFontsSchemaRaw.shape.sansHref.default(null),
    monoHref: brandFontsSchemaRaw.shape.monoHref.default(null),
    sansFamily: brandFontsSchemaRaw.shape.sansFamily.default(null),
    monoFamily: brandFontsSchemaRaw.shape.monoFamily.default(null),
  })
  .default({ sansHref: null, monoHref: null, sansFamily: null, monoFamily: null })
  .refine((fonts) => fonts.sansHref === null || fonts.sansFamily !== null, 'sansHref needs sansFamily')
  .refine((fonts) => fonts.monoHref === null || fonts.monoFamily !== null, 'monoHref needs monoFamily');

export const brandLegalSchemaRaw = z.object({
  companyName: z.string().min(1).max(120),
  /** Rendered in the app footer and on every exported report. */
  footerText: z.string().max(200).nullable(),
  copyrightHolder: z.string().max(120).nullable(),
  termsUrl: httpsUrlSchema.nullable(),
  privacyUrl: httpsUrlSchema.nullable(),
  /**
   * Where this deployment publishes the open-source licence notices the engines
   * require. A PATH, resolved against `brand.origin` at every call site, never an
   * absolute URL: an absolute one would send a reseller's auditor to somebody
   * else's domain.
   */
  noticesPath: rootPathSchema,
  /** Free form line for a regulated reseller. Plain text, never HTML. */
  complianceNotice: z.string().max(400).nullable(),
});

export const brandLegalSchema = z.object({
  ...brandLegalSchemaRaw.shape,
  footerText: brandLegalSchemaRaw.shape.footerText.default(null),
  copyrightHolder: brandLegalSchemaRaw.shape.copyrightHolder.default(null),
  termsUrl: brandLegalSchemaRaw.shape.termsUrl.default(null),
  privacyUrl: brandLegalSchemaRaw.shape.privacyUrl.default(null),
  noticesPath: brandLegalSchemaRaw.shape.noticesPath.default('/legal/notices'),
  complianceNotice: brandLegalSchemaRaw.shape.complianceNotice.default(null),
});

export const brandSupportSchemaRaw = z.object({
  email: z.email().max(200),
  docsUrl: httpsUrlSchema.nullable(),
  statusUrl: httpsUrlSchema.nullable(),
});

export const brandSupportSchema = z.object({
  ...brandSupportSchemaRaw.shape,
  docsUrl: brandSupportSchemaRaw.shape.docsUrl.default(null),
  statusUrl: brandSupportSchemaRaw.shape.statusUrl.default(null),
});

/* ------------------------------------------------------------------ email -- */

export const brandEmailSchemaRaw = z.object({
  /** `appName` in RedAuthEmailBranding. Filled from product.name at registry build. */
  appName: z.string().min(1).max(60),
  /** A literal colour: an email client has no CSS variables and no color-mix. */
  accentColor: cssColorSchema,
  /** Absolute https URL. A root relative path is meaningless in an inbox. */
  logoUrl: httpsUrlSchema.nullable(),
  logoWidth: z.number().int().min(16).max(256),
  /**
   * Nullable in the SCHEMA and never null on the wire: `brandEmailBranding`
   * synthesizes one when it is absent, because redauth's template falls back to
   * a hardcoded "RedBtn. All rights reserved." string, in the one email every
   * single user receives before they ever see the app.
   */
  footerText: z.string().max(200).nullable(),
  /**
   * The envelope From. Never a person's address; an app sends as its own
   * identity. Its DOMAIN must be one the deployment's SMTP transport is
   * authorized for, which `assertDeploymentAuth` checks at boot rather than
   * here, because only the deployment knows its transport.
   */
  fromAddress: z.email().max(200),
});

export const brandEmailSchema = z.object({
  ...brandEmailSchemaRaw.shape,
  logoUrl: brandEmailSchemaRaw.shape.logoUrl.default(null),
  logoWidth: brandEmailSchemaRaw.shape.logoWidth.default(48),
  footerText: brandEmailSchemaRaw.shape.footerText.default(null),
});

/* ------------------------------------------------------------------- auth -- */

export const brandAuthSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('ecosystem'),
    /** Frozen: the shared cookie is the ecosystem's, not a brand's. */
    cookieName: z.literal('red_session').default('red_session'),
    cookieDomain: z.literal('.redbtn.io').default('.redbtn.io'),
    /**
     * Frozen alongside the cookie, and for the same reason. This value is the
     * sign-in REDIRECT TARGET: a wrong one is credential phishing, not a wrong
     * colour.
     */
    accountsUrl: z.literal('https://accounts.redbtn.io').default('https://accounts.redbtn.io'),
    /** The env var NAME holding the HS256 verify key. Never the value. */
    secretEnv: z.literal('JWT_SECRET').default('JWT_SECRET'),
  }),
  z.object({
    mode: z.literal('isolated'),
    /** Host-only cookie, redDLP's proven posture. */
    cookieName: z.string().regex(/^[a-z][a-z0-9_]{2,31}$/),
    /**
     * Empty string means host only and must NOT fall through to the shared
     * default. Typed as a literal so nobody writes '.redbtn.io' here.
     */
    cookieDomain: z.literal('').default(''),
    accountsUrl: z.null().default(null),
    /** Per brand secret, by NAME. The value lives in that deployment's RedRun env. */
    secretEnv: z.string().regex(/^[A-Z][A-Z0-9_]{3,63}$/),
  }),
]);

/* ------------------------------------- features, github, billing, reseller -- */

/**
 * Exhaustive on purpose: a brand states a position on every feature, so adding a
 * feature to the product forces every brand file to be revisited in the same
 * commit.
 */
export const brandFeaturesSchema = z.record(z.enum(FEATURE_KEYS), z.boolean());

/**
 * DISPLAY identity only. redScan holds no GitHub App id, no private key, no
 * installation token and no webhook secret. A field that could be mistaken for a
 * credential must never appear here.
 *
 * **There is no install URL here, derived or stated.** The button's href is
 * always `githubStatusResponse.installUrl`, returned by redScan's own server
 * from the hub. Two sources of truth for one button is the defect, and a
 * redLabel-derived `https://github.com/apps/<slug>/installations/new` is the
 * wrong one of the two: it skips the hub's install flow, whose GitHub Setup URL
 * requires a signed-in redbtn user, so the post-install redirect dead-ends with
 * no error.
 */
export const brandGithubAppSchemaRaw = z.object({
  /** Shown as "Install <name> on your repositories". */
  name: z.string().min(1).max(80),
  /**
   * The App's public slug, the ONLY per brand GitHub fact redLabel carries, and
   * it exists SOLELY for the confused-deputy cross-check. It is never rendered
   * and never becomes a URL. A hostile stored value could therefore only make a
   * legitimate installation fail the cross-check, which is a refusal.
   */
  appSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,38}$/),
  /** One sentence under the button explaining who the installation belongs to. */
  blurb: z.string().max(240).nullable(),
});

export const brandGithubAppSchema = z
  .object({
    name: brandGithubAppSchemaRaw.shape.name.default('Red by redbtn'),
    appSlug: brandGithubAppSchemaRaw.shape.appSlug.default('red-by-redbtn'),
    blurb: brandGithubAppSchemaRaw.shape.blurb.default(null),
  })
  .default({ name: 'Red by redbtn', appSlug: 'red-by-redbtn', blurb: null });

export const brandBillingSchemaRaw = z.object({
  /**
   * The `redbtn_product` metadata value redbilling matches on. A reseller sells
   * under its own Stripe product; same code, different key. Read through the
   * brand, never hardcoded at a call site.
   */
  productKey: z.string().regex(/^[a-z][a-z0-9_.-]{1,48}$/),
  /** Whether this brand shows plan and usage UI at all. Orthogonal to BILLING_ENFORCED. */
  showPlans: z.boolean(),
});

export const brandBillingSchema = z
  .object({
    productKey: brandBillingSchemaRaw.shape.productKey.default('redscan'),
    showPlans: brandBillingSchemaRaw.shape.showPlans.default(false),
  })
  .default({ productKey: 'redscan', showPlans: false });

export const brandResellerSchemaRaw = z
  .object({
    /** Must name another brand in the same registry; `createRegistry` enforces it. */
    parentBrandId: brandIdSchema,
    /** Defaults TRUE. Turning it off is a contract decision, not a styling one. */
    poweredBy: z.boolean(),
  })
  .nullable();

export const brandResellerSchema = z
  .object({
    parentBrandId: brandIdSchema,
    poweredBy: z.boolean().default(true),
  })
  .nullable()
  .default(null);

/* ----------------------------------------------------------------- export -- */

/**
 * The artifacts are the product. A reseller whose in-app theming is perfect and
 * whose evidence pack says redScan has not been whitelabeled.
 */
export const brandExportSchemaRaw = z.object({
  /** `runs[].tool.driver.name` and the PDF cover. Filled from product.name at registry build. */
  toolName: z.string().min(1).max(80).optional(),
  /** `tool.driver.informationUri`. Filled from brand.origin at registry build. */
  toolInformationUri: httpsUrlSchema.optional(),
  /** `tool.driver.organization` and the CycloneDX supplier. From legal.companyName. */
  organization: z.string().min(1).max(120).optional(),
  /** Leads every downloaded filename: `<prefix>-<project>-<scan>.sarif`. */
  filenamePrefix: z.string().regex(/^[a-z][a-z0-9-]{1,23}$/),
  /** Overrides the PDF cover title when the product name is not what the auditor should read. */
  reportTitle: z.string().max(120).nullable(),
});

export const brandExportSchema = z
  .object({
    toolName: brandExportSchemaRaw.shape.toolName,
    toolInformationUri: brandExportSchemaRaw.shape.toolInformationUri,
    organization: brandExportSchemaRaw.shape.organization,
    filenamePrefix: brandExportSchemaRaw.shape.filenamePrefix.default('redscan'),
    reportTitle: brandExportSchemaRaw.shape.reportTitle.default(null),
  })
  .default({ filenamePrefix: 'redscan', reportTitle: null });

/* ------------------------------------------------------------ the record -- */

export const brandSchema = z
  .object({
    id: brandIdSchema,
    /** Exact hosts and suffix claims. A brand nobody can reach is a config bug. */
    hosts: z.array(brandHostSchema).min(1).max(20),
    /**
     * Canonical absolute origin, used for metadataBase, the email logo URL, the
     * notices link and the ecosystem `?next=` return URL. Built from
     * configuration, NEVER from the request host.
     */
    origin: originSchema,
    product: productSchema,
    logo: logoSchema,
    tokens: brandTokensSchema,
    fonts: brandFontsSchema,
    legal: brandLegalSchema,
    support: brandSupportSchema,
    email: brandEmailSchema,
    export: brandExportSchema,
    auth: brandAuthSchema,
    features: brandFeaturesSchema,
    githubApp: brandGithubAppSchema,
    billing: brandBillingSchema,
    reseller: brandResellerSchema,
  })
  .superRefine((brand, ctx) => {
    // 1. Ecosystem mode is only legal on a host accounts will return to. This is
    //    the SAME predicate as the boundary it mirrors, character for character:
    //    `evil-redbtn.io` and `redbtn.io.attacker.com` must both fail, which is
    //    why it is an exact match plus a dot-anchored suffix, not `includes`. It
    //    is `hostname`, not `host`, because `host` carries the port and rejected
    //    a legitimate `https://scan.redbtn.io:8443` while accepting a hostile
    //    apex.
    const ROOT = 'redbtn.io';
    const isFirstParty = (host: string): boolean => host === ROOT || host.endsWith(`.${ROOT}`);
    if (brand.auth.mode === 'ecosystem') {
      for (const [index, host] of brand.hosts.entries()) {
        const bare = host.startsWith('.') ? host.slice(1) : host;
        if (!isFirstParty(bare)) {
          ctx.addIssue({
            code: 'custom',
            path: ['hosts', index],
            message: `ecosystem auth requires a *.redbtn.io host; "${host}" cannot return from accounts`,
          });
        }
      }
      if (!isFirstParty(new URL(brand.origin).hostname)) {
        ctx.addIssue({
          code: 'custom',
          path: ['origin'],
          message: 'ecosystem origin must be redbtn.io',
        });
      }
    }
    // 2. The contrast gate, both schemes.
    for (const scheme of ['dark', 'light'] as const) {
      for (const issue of contrastIssues(brand as Brand, scheme)) {
        ctx.addIssue({ code: 'custom', path: ['tokens', scheme], message: issue });
      }
    }
  });

export type Brand = z.infer<typeof brandSchema>;
/** What a brand FILE may write: every defaulted field is optional. */
export type BrandInput = z.input<typeof brandSchema>;
