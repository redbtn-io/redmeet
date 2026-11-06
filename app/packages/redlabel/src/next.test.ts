import { describe, expect, it } from 'vitest';

import type { Brand } from './brand';
import { medshield } from './brands/medshield';
import { redbtn } from './brands/redbtn';
import { redbtnBeta } from './brands/redbtn-beta';
import {
  brandAssetHosts,
  brandFontLinks,
  brandIcons,
  brandManifest,
  brandMetadata,
  brandViewport,
} from './next';
import { createRegistry } from './resolve';
import lock from '../brand-icons.lock.json' with { type: 'json' };

/** Section 10.6, the Next helpers. Pure: no request, no filesystem, no React. */

const REGISTRY = createRegistry({
  brands: [redbtn, redbtnBeta, medshield],
  defaultBrandId: 'redbtn',
});
const REDBTN = REGISTRY.brands['redbtn'] as Brand;
const BETA = REGISTRY.brands['redbtn-beta'] as Brand;
const MEDSHIELD = REGISTRY.brands['medshield'] as Brand;

const ICON_LOCK = lock as Record<string, { sha256: string; width: number; height: number; bytes: number }>;

describe('brandMetadata', () => {
  it('never emits black-translucent, and there is no option to', () => {
    for (const brand of [REDBTN, BETA, MEDSHIELD]) {
      const metadata = brandMetadata(brand);
      expect(JSON.stringify(metadata)).not.toContain('black-translucent');
      expect(metadata.appleWebApp).toMatchObject({ capable: true, statusBarStyle: 'default' });
    }
  });

  it('metadataBase and the OG image are the brand origin, never the request host', () => {
    const metadata = brandMetadata(MEDSHIELD);
    expect(metadata.metadataBase?.toString()).toBe('https://scan-demo.redbtn.io/');
    expect(JSON.stringify(metadata.openGraph?.images)).toContain('https://scan-demo.redbtn.io/brand/medshield/logo.png');
  });

  it('the title template uses product.short, which is what fits tight chrome', () => {
    expect(brandMetadata(MEDSHIELD).title).toEqual({
      default: 'MedShield Code Assurance',
      template: '%s · MedShield',
    });
  });

  it('a page title is absolute, so the template does not double up', () => {
    expect(brandMetadata(REDBTN, { title: 'Findings' }).title).toEqual({ absolute: 'Findings' });
  });

  it('noIndex is opt in and canonical follows the path', () => {
    const metadata = brandMetadata(REDBTN, { path: '/findings', noIndex: true });
    expect(metadata.alternates).toEqual({ canonical: '/findings' });
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(brandMetadata(REDBTN).robots).toBeUndefined();
  });
});

describe('brandIcons', () => {
  it('emits no URL outside /brand/<id>/', () => {
    for (const brand of [REDBTN, BETA, MEDSHIELD]) {
      const urls = JSON.stringify(brandIcons(brand)).match(/"url":"([^"]+)"/g) ?? [];
      expect(urls.length).toBeGreaterThan(0);
      for (const entry of urls) {
        expect(entry, brand.id).toMatch(/"url":"\/brand\/[a-z-]+\//);
      }
    }
  });

  it('there is no /favicon.ico fallback: the root probe is a route, not a file', () => {
    expect(JSON.stringify(brandIcons(REDBTN))).not.toContain('"/favicon.ico"');
  });

  it('beta reuses redbtn assets, because an asset path is same origin on whichever host serves it', () => {
    expect(brandIcons(BETA)).toEqual(brandIcons(REDBTN));
  });
});

describe('brandManifest', () => {
  it('icon sizes come from the LOCK, never from a literal and never from a file read', () => {
    // This closes redboard's bug: a manifest declaring /logo.png as 512x512 when
    // the file is 1024.
    for (const brand of [REDBTN, MEDSHIELD]) {
      for (const icon of brandManifest(brand).icons ?? []) {
        const key = String(icon.src).replace(/^\/brand\//, '');
        const entry = ICON_LOCK[key];
        expect(entry, key).toBeDefined();
        expect(icon.sizes, key).toBe(`${entry?.width}x${entry?.height}`);
      }
    }
  });

  it('every path a brand declares is in the lock, for both icon sets in this repo', () => {
    for (const brand of [REDBTN, BETA, MEDSHIELD]) {
      const declared = [
        brand.logo.markUrl,
        brand.logo.masterUrl,
        brand.logo.faviconUrl,
        brand.logo.appleIconUrl,
        brand.logo.maskableUrl,
      ].filter((url): url is string => typeof url === 'string' && url.startsWith('/brand/'));
      for (const url of declared) {
        expect(ICON_LOCK[url.replace(/^\/brand\//, '')], `${brand.id} ${url}`).toBeDefined();
      }
    }
  });

  it('carries the maskable entry, which a circular Android crop needs', () => {
    const icons = brandManifest(MEDSHIELD).icons ?? [];
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('names and colours are the brand’s', () => {
    const manifest = brandManifest(MEDSHIELD);
    expect(manifest.name).toBe('MedShield Code Assurance');
    expect(manifest.short_name).toBe('MedShield');
    expect(manifest.theme_color).toBe('#07101a');
    expect(manifest.background_color).toBe('#07101a');
    expect(manifest.short_name?.length).toBeLessThanOrEqual(12);
  });
});

describe('brandViewport', () => {
  it('emits exactly two themeColor entries, one per media query', () => {
    const themeColor = brandViewport(MEDSHIELD).themeColor;
    expect(Array.isArray(themeColor)).toBe(true);
    expect(themeColor).toEqual([
      { media: '(prefers-color-scheme: dark)', color: '#07101a' },
      { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    ]);
  });

  it('sets viewportFit cover, without which iOS never populates safe-area-inset', () => {
    expect(brandViewport(REDBTN).viewportFit).toBe('cover');
  });
});

describe('brandAssetHosts and brandFontLinks', () => {
  it("the only remote host in v0 is medshield's font CDN", () => {
    // Every other asset is a root-relative path this app serves. The list feeds
    // the CSP img-src, style-src and font-src AND images.remotePatterns, from one
    // place, so a reseller's CDN cannot be forgotten in one of them.
    expect(brandAssetHosts(REGISTRY)).toEqual(['fonts.googleapis.com', 'scan-beta.redbtn.io', 'scan-demo.redbtn.io', 'scan.redbtn.io']);
  });

  it('a brand with no font override renders no link, so the fast path is unchanged', () => {
    expect(brandFontLinks(REDBTN)).toEqual([]);
    expect(brandFontLinks(MEDSHIELD)).toEqual([
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    ]);
  });
});
