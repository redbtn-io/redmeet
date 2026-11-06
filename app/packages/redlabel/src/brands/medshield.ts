import type { BrandInput } from '../brand';

/**
 * The demo reseller, and the brand that proves the seam end to end.
 *
 * Every axis redLabel claims is exercised here, on infrastructure that already
 * exists: `scan-demo.redbtn.io` is one label under the wildcard, so no DNS
 * record and no TLS work, added as an `appConfig.customDomains` entry on the
 * existing `redscan` workspace. ONE DEPLOYMENT SERVES TWO BRANDS, so per-request
 * resolution is exercised in production rather than in a test.
 *
 * `auth.mode: 'ecosystem'` is legal only because the host is `*.redbtn.io`, and
 * the schema enforces exactly that. The moment this brand moves to
 * `scan.medshield.io` it becomes `mode: 'isolated'` with its own secret in its
 * own RedRun workspace of the same image: a brand file change plus a workspace,
 * not a code change. That transition is the only interesting difference between
 * a demo and a real reseller.
 *
 * **The light accent is the lesson, not a workaround.** `#0ea5e9` measures 6.90
 * against MedShield's own dark surface and 2.66 against redstyle's light
 * `#fafafa`, below the 3.0 non-text floor, so one accent for both schemes is
 * REFUSED by the contrast gate. `#0284c7` measures 3.92. A reseller who wants a
 * pale accent gets a darker one in light mode, stated in its own brand file, not
 * a weaker gate.
 *
 * `medshield` is a demo config for a named prospect, not a signed reseller. The
 * brand id, product name and copy are one file and renaming it is a one-commit
 * change; that is George's call before anything is shown outside the fleet.
 */
export const medshield = {
  id: 'medshield',
  hosts: ['scan-demo.redbtn.io'],
  origin: 'https://scan-demo.redbtn.io',
  product: {
    name: 'MedShield Code Assurance',
    short: 'MedShield',
    tagline: 'Evidence for every gate.',
    // Never split: takes the {plain} path. A whitelabel library must not carry
    // redbtn's own prefix as the behaviour every adopter inherits.
    wordmarkPrefix: null,
    vocabulary: {
      scan: 'assessment',
      scans: 'assessments',
      finding: 'observation',
      findings: 'observations',
      gate: 'gate review',
      report: 'evidence pack',
      reports: 'evidence packs',
      sbom: 'CBOM',
      project: 'product',
      projects: 'products',
    },
  },
  logo: {
    markUrl: '/brand/medshield/icon-192.png',
    masterUrl: '/brand/medshield/logo.png',
    faviconUrl: '/brand/medshield/favicon-32x32.png',
    appleIconUrl: '/brand/medshield/apple-touch-icon.png',
    maskableUrl: '/brand/medshield/icon-maskable-512.png',
    markSize: 192,
    // A flat reseller logo must not get the redbtn disc's glow, or it reads as a
    // rendering bug.
    glow: false,
    alt: 'MedShield',
  },
  tokens: {
    // hover, muted, focus ring and foreground are all derived from this one value.
    shared: { accent: '#0ea5e9' },
    dark: { 'bg-primary': '#07101a', 'bg-secondary': '#0d1b26' },
    light: {
      accent: '#0284c7', // 3.92 on #fafafa; the shared #0ea5e9 is 2.66
      'accent-text': '#0369a1', // 5.69 on #fafafa, 5.40 on #f4f4f5
    },
  },
  fonts: {
    sansHref: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    sansFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
    monoHref: null,
    monoFamily: null,
  },
  legal: {
    companyName: 'MedShield',
    footerText: 'MedShield Code Assurance',
    copyrightHolder: 'MedShield',
    termsUrl: null,
    privacyUrl: null,
    noticesPath: '/legal/notices',
    complianceNotice: 'Assessment evidence is retained for the configured record period.',
  },
  support: { email: 'support@redbtn.io', docsUrl: null, statusUrl: null },
  email: {
    appName: 'MedShield',
    accentColor: '#0ea5e9',
    logoUrl: 'https://scan-demo.redbtn.io/brand/medshield/icon-192.png',
    logoWidth: 48,
    footerText: 'Sent by MedShield Code Assurance',
    fromAddress: 'scan@redbtn.io',
  },
  // A full export identity, so a SARIF handed to an auditor says MedShield and
  // never redScan. This is the whitelabel sale, not a nicety.
  export: {
    toolName: 'MedShield Code Assurance',
    organization: 'MedShield',
    filenamePrefix: 'medshield',
    reportTitle: 'Code Assurance Evidence Pack',
  },
  auth: { mode: 'ecosystem' },
  features: {
    sast: true,
    sca: true,
    secrets: true,
    sbom: true,
    aiTriage: true,
    // One feature deliberately off, so the packaging seam is exercised.
    aiFix: false,
    githubConnect: true,
    zipUpload: true,
    schedules: true,
    ciKeys: true,
    billing: false,
    notifications: true,
  },
  githubApp: {
    // DISPLAY identity only. The install destination is always the hub's
    // `githubStatusResponse.installUrl`; `appSlug` exists solely for the
    // confused-deputy cross-check and is never rendered and never a URL.
    name: 'Red by redbtn',
    appSlug: 'red-by-redbtn',
    blurb: 'MedShield connects repositories through the redbtn GitHub App.',
  },
  billing: { productKey: 'medshield', showPlans: false },
  reseller: { parentBrandId: 'redbtn', poweredBy: true },
} satisfies BrandInput;
