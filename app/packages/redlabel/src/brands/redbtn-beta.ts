import type { BrandInput } from '../brand';
import { redbtn } from './redbtn';

/**
 * Beta is its own brand, and that is not tidiness.
 *
 * **One brand may not claim two environments.** `origin` is the sign-in `?next=`
 * base, `metadataBase`, the OG image base and the email logo base, so a single
 * brand claiming `scan.redbtn.io` and `scan-beta.redbtn.io` while carrying one
 * origin makes signing in on beta return the user to PRODUCTION, and makes
 * beta's magic-link emails point at production assets. `createRegistry` refuses
 * a host outside the brand's own origin, so that configuration no longer parses.
 *
 * It reuses redbtn's committed icons at `/brand/redbtn/...`, because an asset
 * path is same-origin on whichever host serves it and there is no reason to
 * duplicate nine PNGs to change a hostname.
 */
export const redbtnBeta = {
  ...redbtn,
  id: 'redbtn-beta',
  hosts: ['scan-beta.redbtn.io'],
  origin: 'https://scan-beta.redbtn.io',
  product: { ...redbtn.product, tagline: 'Find the vulnerabilities that matter. (beta)' },
  email: {
    ...redbtn.email,
    logoUrl: 'https://scan-beta.redbtn.io/brand/redbtn/icon-192.png',
    footerText: 'Sent by redScan (beta)',
  },
  export: { filenamePrefix: 'redscan-beta', reportTitle: null },
} satisfies BrandInput;
