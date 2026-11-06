/**
 * The Next helpers. PURE: they take a `Brand` and return plain objects, import
 * no React and touch no request API, so they work from `generateMetadata`, from
 * `app/manifest.ts` and from a test.
 *
 * redLabel NEVER READS A FILE AT RUNTIME. Next's standalone trace follows module
 * imports, not files, so an `fs.readFile('assets/redbtn/logo.png')` anywhere in
 * this package would work in development and 404 in a container. Icons are URLs;
 * dimensions come from the imported lock.
 */
import type { Metadata, MetadataRoute, Viewport } from 'next';

import type { Brand } from './brand';
import type { BrandRegistry } from './resolve';
import { resolveBrandColors } from './tokens';
import lock from '../brand-icons.lock.json' with { type: 'json' };

type IconLock = Record<string, { sha256: string; width: number; height: number; bytes: number }>;

const ICON_LOCK = lock as IconLock;

/** `192x192`, read from the lock rather than from a literal or a file read. */
function sizeOf(url: string, fallback: number): string {
  const key = url.replace(/^\/brand\//, '');
  const entry = ICON_LOCK[key];
  if (entry && entry.width > 0 && entry.height > 0) return `${entry.width}x${entry.height}`;
  return `${fallback}x${fallback}`;
}

/**
 * Icons, all of them under `/brand/<id>/`.
 *
 * There is NO `'/favicon.ico'` fallback and no path outside `/brand/<id>/`: a
 * root icon FILE is served to every brand host on the deployment, so the two
 * root probes are route handlers that resolve the brand from the request host.
 */
export function brandIcons(brand: Brand): NonNullable<Metadata['icons']> {
  const icon: Array<{ url: string; sizes?: string; type?: string }> = [];
  if (brand.logo.faviconUrl !== null) {
    icon.push({ url: brand.logo.faviconUrl, sizes: sizeOf(brand.logo.faviconUrl, 32), type: 'image/png' });
  }
  icon.push({ url: brand.logo.markUrl, sizes: sizeOf(brand.logo.markUrl, brand.logo.markSize), type: 'image/png' });

  const icons: NonNullable<Metadata['icons']> = { icon };
  if (brand.logo.appleIconUrl !== null) {
    (icons as { apple?: unknown }).apple = [{ url: brand.logo.appleIconUrl, sizes: '180x180' }];
  }
  return icons;
}

export function brandMetadata(
  brand: Brand,
  page?: { title?: string; description?: string; path?: string; noIndex?: boolean },
): Metadata {
  const description = page?.description ?? brand.product.tagline ?? brand.product.name;
  const image = new URL(brand.logo.masterUrl, brand.origin).toString();
  const metadata: Metadata = {
    metadataBase: new URL(brand.origin),
    title: page?.title
      ? { absolute: page.title }
      : { default: brand.product.name, template: `%s · ${brand.product.short}` },
    description,
    applicationName: brand.product.name,
    icons: brandIcons(brand),
    manifest: '/manifest.webmanifest',
    openGraph: {
      type: 'website',
      siteName: brand.product.name,
      title: page?.title ?? brand.product.name,
      description,
      url: page?.path ? new URL(page.path, brand.origin).toString() : brand.origin,
      images: [{ url: image }],
    },
    twitter: {
      card: 'summary',
      title: page?.title ?? brand.product.name,
      description,
      images: [image],
    },
    appleWebApp: {
      capable: true,
      title: brand.product.short,
      // NEVER 'black-translucent': it reserves the iOS home-indicator strip and
      // no CSS gets the space back. There is no option to change this.
      statusBarStyle: 'default',
    },
  };
  if (page?.path) metadata.alternates = { canonical: page.path };
  if (page?.noIndex) metadata.robots = { index: false, follow: false };
  return metadata;
}

export function brandViewport(brand: Brand): Viewport {
  const dark = resolveBrandColors(brand, 'dark')['bg-primary' as 'bg-primary'] as string;
  const light = resolveBrandColors(brand, 'light')['bg-primary' as 'bg-primary'] as string;
  return {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    // Without it iOS never populates safe-area-inset-*.
    viewportFit: 'cover',
    themeColor: [
      { media: '(prefers-color-scheme: dark)', color: dark },
      { media: '(prefers-color-scheme: light)', color: light },
    ],
  };
}

export function brandManifest(brand: Brand): MetadataRoute.Manifest {
  const dark = resolveBrandColors(brand, 'dark')['bg-primary' as 'bg-primary'] as string;
  const icons: MetadataRoute.Manifest['icons'] = [
    {
      src: brand.logo.markUrl,
      sizes: sizeOf(brand.logo.markUrl, brand.logo.markSize),
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: brand.logo.masterUrl,
      sizes: sizeOf(brand.logo.masterUrl, 1024),
      type: 'image/png',
      purpose: 'any',
    },
  ];
  if (brand.logo.maskableUrl !== null) {
    icons.push({
      src: brand.logo.maskableUrl,
      sizes: sizeOf(brand.logo.maskableUrl, 512),
      type: 'image/png',
      purpose: 'maskable',
    });
  }
  return {
    name: brand.product.name,
    short_name: brand.product.short,
    description: brand.product.tagline ?? brand.product.name,
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: dark,
    theme_color: dark,
    icons,
  };
}

/**
 * Every https host any brand references, for the CSP `img-src`, `style-src` and
 * `font-src` lists and for `images.remotePatterns`. Built from the registry in
 * one place, so a reseller serving its logo or its fonts from its own CDN cannot
 * be forgotten in one of the two.
 */
export function brandAssetHosts(registry: BrandRegistry): string[] {
  const hosts = new Set<string>();
  for (const brand of Object.values(registry.brands)) {
    const candidates = [
      brand.logo.markUrl,
      brand.logo.masterUrl,
      brand.logo.wordmarkUrl,
      brand.logo.faviconUrl,
      brand.logo.appleIconUrl,
      brand.logo.maskableUrl,
      brand.fonts.sansHref,
      brand.fonts.monoHref,
      brand.email.logoUrl,
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !candidate.startsWith('https://')) continue;
      hosts.add(new URL(candidate).host);
    }
  }
  return [...hosts].sort();
}

/**
 * The stylesheet hrefs `<head>` must render for this brand. `next/font` cannot
 * be driven by runtime data, so a brand with a font override renders a plain
 * `<link rel="stylesheet">`; a brand with none returns an empty array and the
 * fast path is unchanged.
 */
export function brandFontLinks(brand: Brand): string[] {
  return [brand.fonts.sansHref, brand.fonts.monoHref].filter(
    (href): href is string => typeof href === 'string',
  );
}
