/**
 * Feature packaging.
 *
 * Three rules, and the first is the one that matters:
 *
 *  1. A feature toggle is PACKAGING, not a security boundary and not a
 *     commercial control. Tenancy is `withOrg`; entitlements are the plan gate.
 *     A hidden feature must still be refused server side by its own check.
 *  2. `feature()` gates rendering only. Never branch a data path on it.
 *  3. CI asserts every `feature('x')` literal in the app is a member of
 *     `FEATURE_KEYS`, so a typo is a build failure rather than a silently
 *     hidden panel.
 */
import type { Brand } from './brand';

export const FEATURE_KEYS = [
  'sast', 'sca', 'secrets', 'sbom', 'aiTriage', 'aiFix',
  'githubConnect', 'zipUpload', 'schedules', 'ciKeys', 'billing', 'notifications',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/**
 * Unknown or absent means false. `brandFeaturesSchema` is exhaustive, so
 * absence should be impossible and the `?? false` is the belt.
 */
export function feature(brand: Brand, key: FeatureKey): boolean {
  return brand.features[key] ?? false;
}
