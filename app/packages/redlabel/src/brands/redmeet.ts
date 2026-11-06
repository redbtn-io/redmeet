import type { BrandInput } from '../brand';

/**
 * redMeet's own brand: this deployment's face.
 *
 * redMeet is a first-party redbtn product, so the brand wears the redbtn
 * face outright: the ecosystem auth plan, the redbtn mark (the logo URLs
 * below are the `/brand/redbtn/` asset set, copied into `web/public/brand`
 * by the redlabel-icons script), and redstyle's own palette untouched.
 *
 * `tokens` empty is the point, exactly as in `./redbtn`: no redstyle
 * declared token differs for this brand, so any such difference is a
 * redLabel bug. What it does emit is the two extra properties redstyle
 * reads but never declares, which change nothing redstyle styles.
 *
 * `localhost` is NOT in `hosts`, and must not be: dev needs no entry,
 * because an unmatched host falls to resolution rule 3 and renders the
 * deployment brand, through the exact code path production uses for an
 * unknown host. The honest cost is that sign-in cannot COMPLETE on
 * localhost, because `signInUrl` builds from `brand.origin`, which is
 * configuration.
 *
 * `features` states a position on every key because the schema is
 * exhaustive. The keys are the estate's shared feature vocabulary; the
 * scan-specific ones are simply off. redMeet's own surface is
 * `schedules`, and it sends no notifications today.
 */
export const redmeet = {
  id: 'redmeet',
  hosts: ['meet.redbtn.io'],
  origin: 'https://meet.redbtn.io',
  product: {
    name: 'redMeet',
    short: 'redMeet',
    tagline: 'Simple meeting scheduling on your real calendar.',
    wordmarkPrefix: 'red',
    vocabulary: {},
  },
  logo: {
    markUrl: '/brand/redbtn/icon-192.png',
    masterUrl: '/brand/redbtn/logo.png',
    faviconUrl: '/brand/redbtn/favicon-32x32.png',
    appleIconUrl: '/brand/redbtn/apple-touch-icon.png',
    maskableUrl: '/brand/redbtn/icon-maskable-512.png',
    markSize: 192,
    glow: true,
    alt: 'redbtn',
  },
  tokens: { shared: {}, dark: {}, light: {} },
  fonts: { sansHref: null, monoHref: null, sansFamily: null, monoFamily: null },
  legal: {
    companyName: 'redbtn',
    footerText: null,
    copyrightHolder: 'redbtn',
    termsUrl: 'https://redbtn.io/terms',
    privacyUrl: 'https://redbtn.io/privacy',
    noticesPath: '/legal/notices',
    complianceNotice: null,
  },
  support: { email: 'support@redbtn.io', docsUrl: 'https://redbtn.io/docs', statusUrl: null },
  email: {
    appName: 'redMeet',
    accentColor: '#ef4444',
    logoUrl: 'https://meet.redbtn.io/brand/redbtn/icon-192.png',
    logoWidth: 48,
    footerText: 'Sent by redMeet',
    fromAddress: 'meet@redbtn.io',
  },
  // toolName, toolInformationUri and organization are filled by createRegistry.
  export: { filenamePrefix: 'redmeet' },
  auth: { mode: 'ecosystem' },
  features: {
    sast: false,
    sca: false,
    secrets: false,
    sbom: false,
    aiTriage: false,
    aiFix: false,
    githubConnect: false,
    zipUpload: false,
    schedules: true,
    ciKeys: false,
    billing: false,
    notifications: false,
  },
  // The defaults ARE "Red by redbtn" and "red-by-redbtn".
  githubApp: {},
  billing: { productKey: 'redmeet', showPlans: false },
  reseller: null,
} satisfies BrandInput;
