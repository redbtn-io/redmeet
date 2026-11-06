import type { BrandInput } from '../brand';

/**
 * The default brand, and the reference implementation every reseller diffs
 * against.
 *
 * `tokens` empty is the point: **no redstyle-declared token differs between the
 * redbtn brand and bare redstyle**, so any such difference is a redLabel bug.
 * What it does emit is the two extra properties redstyle reads but never
 * declares, which change nothing redstyle styles.
 *
 * `localhost` is NOT in `hosts`, and must not be. `brandHostSchema` requires a
 * dot-anchored label group and the ecosystem rule refuses any host that is not
 * redbtn.io or a label under it, so a loopback entry fails parsing twice. Dev
 * needs no entry: `localhost` matches nothing, falls to resolution rule 3 and
 * renders the deployment brand, through the exact code path production uses for
 * an unknown host. The honest cost is that sign-in cannot COMPLETE on localhost,
 * because `signInUrl` builds from `brand.origin`, which is configuration.
 */
export const redbtn = {
  id: 'redbtn',
  hosts: ['scan.redbtn.io'],
  origin: 'https://scan.redbtn.io',
  product: {
    name: 'redScan',
    short: 'redScan',
    tagline: 'Find the vulnerabilities that matter.',
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
    appName: 'redScan',
    accentColor: '#ef4444',
    logoUrl: 'https://scan.redbtn.io/brand/redbtn/icon-192.png',
    logoWidth: 48,
    footerText: 'Sent by redScan',
    fromAddress: 'scan@redbtn.io',
  },
  // toolName, toolInformationUri and organization are filled by createRegistry.
  export: {},
  auth: { mode: 'ecosystem' },
  features: {
    sast: true,
    sca: true,
    secrets: true,
    sbom: true,
    aiTriage: true,
    aiFix: true,
    githubConnect: true,
    zipUpload: true,
    schedules: true,
    ciKeys: true,
    billing: false,
    notifications: true,
  },
  // The defaults ARE "Red by redbtn" and "red-by-redbtn".
  githubApp: {},
  billing: { productKey: 'redscan', showPlans: false },
  reseller: null,
} satisfies BrandInput;
