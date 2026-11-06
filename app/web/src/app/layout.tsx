import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';

import { brandMetadata, brandFontLinks, brandViewport } from '@redbtn/redlabel/next';
import { BrandThemeScript, ThemeStyle, brandStyleProps } from '@redbtn/redlabel/theme';

import { getBrand } from '@/lib/brand';
import { NONCE_HEADER } from '@/proxy';

import './globals.css';

/**
 * The root layout, on the canonical redlabel port.
 *
 * Three things here are theming contract, not decoration:
 *
 *  1. **`brandStyleProps(brand)`** puts the hoisted custom properties and
 *     `data-brand` on `<html>`. An inline style attribute outranks every
 *     selector and sits in the first byte of HTML, so it cannot flash, which
 *     is exactly why only values that are correct in BOTH schemes live
 *     there.
 *  2. **The literal `dark` class.** Together with `<BrandThemeScript>`,
 *     which runs synchronously in `<head>` and rewrites it to `light` when
 *     that is the stored theme, it guarantees a scheme class is on `<html>`
 *     in the first byte and at every moment after. Every selector
 *     `<ThemeStyle>` emits names a scheme, so removing either is a theming
 *     break rather than a cleanup. Dark is the default; a stored `light`
 *     preference is applied before first paint, never after.
 *  3. **No `icons` key of its own.** `brandMetadata` supplies them, all
 *     under `/brand/<id>/`, and there is no root icon FILE anywhere: one
 *     would be served to every brand host on the deployment.
 *
 * There is no `ThemeProvider`: redstyle's returns null until mounted, which
 * blanks the first paint, and it hardcodes the PWA theme colour to two
 * literals that ignore the brand. The interactive control is the app's own
 * `ThemeToggle`, which speaks the boot script's protocol.
 */

export async function generateMetadata(): Promise<Metadata> {
  return brandMetadata(await getBrand());
}

export async function generateViewport(): Promise<Viewport> {
  const viewport = brandViewport(await getBrand());
  return {
    ...viewport,
    // Mobile: no user-scaling lock (accessibility), viewport-fit for
    // notched iPhones. interactiveWidget=resizes-content: on Chrome
    // Android the virtual keyboard resizes the layout viewport instead of
    // covering the prompt box. brandViewport pins maximumScale for the
    // PWA shell; redMeet's pages are content, so the lock comes off.
    maximumScale: undefined,
    interactiveWidget: 'resizes-content',
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  const fontLinks = brandFontLinks(brand);
  // The per-request nonce `proxy.ts` minted. Next stamps its own inline
  // scripts with it from the request's `content-security-policy` header;
  // the theme boot script is ours, so it is stamped here.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  return (
    <html lang="en" className="dark" {...brandStyleProps(brand)} suppressHydrationWarning>
      <head>
        {/* `next/font` cannot be driven by runtime data, so a brand with a
            font override renders a plain stylesheet link and the default
            brand renders none. */}
        {fontLinks.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        <ThemeStyle brand={brand} />
        <BrandThemeScript brand={brand} nonce={nonce} />
      </head>
      <body className="bg-bg text-text-primary antialiased">{children}</body>
    </html>
  );
}
