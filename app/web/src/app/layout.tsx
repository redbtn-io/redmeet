import type { Metadata, Viewport } from 'next';

import { brandMetadata } from '@redbtn/redlabel/next';

import './globals.css';

export const metadata: Metadata = {
  ...brandMetadata(),
  icons: { icon: '/icons/redbtn-logo.png', apple: '/icons/redbtn-logo.png' },
};

/** Mobile viewport: no user-scaling lock (accessibility), viewport-fit for notched iPhones.
 * interactiveWidget=resizes-content: on Chrome Android the virtual keyboard
 * resizes the layout viewport instead of covering the prompt box. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0a0f',
  interactiveWidget: 'resizes-content',
};

/**
 * Root layout, v0.
 *
 * The brand system (BrandThemeScript, brandStyleProps, ThemeStyle) lands with
 * the canonical packages/redlabel port. Until then: plain shell on the
 * redstyle token classes, no flash-prone inline theming to get wrong.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg text-text-primary antialiased">{children}</body>
    </html>
  );
}
