import type { MetadataRoute } from 'next';

/**
 * PWA manifest (Android Chrome "Add to Home screen" / standalone launch).
 * The SVG icon is a real committed asset (dark tile + the red button mark),
 * so it serves as both the `any` and `maskable` entry.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'redMeet',
    short_name: 'redMeet',
    description:
      'Simple meeting scheduling. Share one link, guests book against your real calendar.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0a0a0f',
    theme_color: '#0a0a0f',
    lang: 'en',
    dir: 'ltr',
    categories: ['productivity', 'business'],
    icons: [
      {
        src: '/icons/redbtn-logo.png',
        sizes: 'any',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/redbtn-logo.png',
        sizes: 'any',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
