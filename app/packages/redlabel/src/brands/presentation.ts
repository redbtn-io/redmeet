/**
 * The client-safe presentation subset of a brand, and the static table of it for
 * every brand this package ships.
 *
 * **There is no `import 'server-only'` here, and that is the whole point.** This
 * is the one brand module a CLIENT component may import. `app/global-error.tsx`
 * replaces the root layout, including `<html>` and `<body>`, and Next requires it
 * to be a client component, so it can reach neither `./server` (request APIs) nor
 * `./brands` (the registry, `server-only`), and redlabel.md 6.5's
 * `brandStyleProps(deploymentBrand(REGISTRY))` cannot be written there. The
 * error screen would then paint redstyle's `#0a0a0a` on a reseller's container:
 * the one screen a user sees when everything else has already failed, wearing the
 * wrong face.
 *
 * What makes shipping this to a browser safe is the SUBSET, not a promise. Five
 * fields: the id (already a DOM attribute on every page), two surface colours
 * (already computed into the emitted CSS of every page), the short product name
 * (in the header of every page) and the support email (in the footer of every
 * page). Every one of them is on the wire already. What the registry additionally
 * holds, and what a client import of `./brands` would leak, is every OTHER
 * brand's config: support addresses, legal text, font CDNs, billing product keys,
 * each reseller's palette. None of that is here.
 *
 * `BRAND_PRESENTATIONS` is a literal table rather than a projection of the brand
 * files on purpose: importing `./redbtn` and `./medshield` to compute it would
 * pull both whole records into any bundle that touches this module, which is the
 * leak the subset exists to prevent. The duplication is pinned by a test that
 * asserts each row equals `brandPresentation(<the brand>)`, so drift is a red
 * suite rather than a wrong colour.
 */
import type { Brand } from '../brand';
import { resolveBrandColors, type CssVarMap } from '../tokens';

export interface BrandPresentation {
  /** The `data-brand` attribute value, and the key of the scheme blocks below. */
  id: string;
  /** The dark scheme's `bg-primary`, as a literal. */
  surfaceDark: string;
  /** The light scheme's `bg-primary`, as a literal. */
  surfaceLight: string;
  /** `product.short`: tight chrome, and the only name an error screen needs. */
  productShort: string;
  /** Where a user whose page just crashed is told to write. */
  supportEmail: string;
}

/** The projection. Pure, and the definition every row in the table is checked against. */
export function brandPresentation(brand: Brand): BrandPresentation {
  return {
    id: brand.id,
    surfaceDark: resolveBrandColors(brand, 'dark')['bg-primary'] as string,
    surfaceLight: resolveBrandColors(brand, 'light')['bg-primary'] as string,
    productShort: brand.product.short,
    supportEmail: brand.support.email,
  };
}

/**
 * Every brand this package ships, as the client-safe subset.
 *
 * Keyed by id, so a consumer that knows which brand its deployment IS (from a
 * build-time constant, or from nothing at all) can look it up without the
 * registry. An adopter with its own brands extends this map in its own module;
 * nothing here is a closed world.
 */
export const BRAND_PRESENTATIONS: Readonly<Record<string, BrandPresentation>> = Object.freeze({
  redbtn: {
    id: 'redbtn',
    surfaceDark: '#0a0a0a',
    surfaceLight: '#fafafa',
    productShort: 'redScan',
    supportEmail: 'support@redbtn.io',
  },
  'redbtn-beta': {
    id: 'redbtn-beta',
    surfaceDark: '#0a0a0a',
    surfaceLight: '#fafafa',
    productShort: 'redScan',
    supportEmail: 'support@redbtn.io',
  },
  medshield: {
    id: 'medshield',
    surfaceDark: '#07101a',
    surfaceLight: '#fafafa',
    productShort: 'MedShield',
    supportEmail: 'support@redbtn.io',
  },
});

/** The last resort. An unknown id is the default brand's face, never a throw and never blank. */
export const DEFAULT_PRESENTATION: BrandPresentation = BRAND_PRESENTATIONS[
  'redbtn'
] as BrandPresentation;

export function presentationFor(id: string | null | undefined): BrandPresentation {
  if (typeof id !== 'string' || id === '') return DEFAULT_PRESENTATION;
  return BRAND_PRESENTATIONS[id] ?? DEFAULT_PRESENTATION;
}

/**
 * The `<html>` style attribute for a rootless surface.
 *
 * Only `--text-tertiary`, because it is the one property redLabel emits whose
 * value is identical in both schemes for every brand, and because nothing else
 * declares it. The two surface colours are scheme dependent, so they belong in
 * the blocks below and never in an attribute that outranks every selector.
 */
export function presentationStyle(_presentation: BrandPresentation): CssVarMap {
  return { '--text-tertiary': 'color-mix(in srgb,var(--text-muted) 70%,var(--bg-primary))' };
}

/**
 * The per-scheme surface, in exactly the selector shape `themeStyleCss` emits, so
 * an error screen and an ordinary page are painted by the same rules at the same
 * specificity.
 *
 * `--error-foreground` is deliberately NOT emitted here: redLabel's own
 * stylesheet reads it as `var(--error-foreground, #ffffff)`, and that fallback
 * exists for precisely this surface (redlabel.md 4.4).
 */
export function presentationThemeCss(presentation: BrandPresentation): string {
  const attribute = `[data-brand="${presentation.id}"]`;
  return (
    `:root${attribute}.dark,\n${attribute}.dark{--bg-primary:${presentation.surfaceDark}}\n` +
    `:root${attribute}.light,\n${attribute}.light{--bg-primary:${presentation.surfaceLight}}`
  );
}
