/**
 * The IDENTITY PLATFORM: where the account lives.
 *
 * This is not `poweredBy` and it is not `product.name`, and conflating them is
 * how the product's only call to action came to read "Sign in with redScan".
 * Three different facts were being served by one derivation:
 *
 *   - `product.name` is WHAT THIS IS ("redScan", "MedShield Code Assurance");
 *   - `poweredBy` is an ATTRIBUTION LINE a reseller shows at the bottom of a
 *     page, and it names the parent brand's PRODUCT;
 *   - the platform is WHERE THE ACCOUNT IS, which is what a sign-in button, a
 *     "connect your GitHub App" instruction and a "revoke it there" footnote all
 *     mean.
 *
 * Deriving the third from the second gave `brand.product.name` on every brand
 * with no reseller (so "Sign in with redScan", which is circular and tells a
 * stranger nothing) and the PARENT'S PRODUCT NAME on a reseller (so MedShield's
 * users were told to install the GitHub App in redScan, leaking the parent
 * product name onto a reseller host).
 *
 * The rule is the auth mode, because the auth mode IS the statement about whose
 * accounts these are:
 *
 *   - `ecosystem`: sessions are minted by redbtn's accounts service and redScan
 *     mints nothing, so the platform is redbtn, reseller or not.
 *   - `isolated`: the deployment is its own authority with its own secret and
 *     its own sign-in routes (the redDLP posture), so the platform is the brand
 *     itself.
 */
import type { Brand } from './brand';

/** The ecosystem's identity platform. Never a product name. */
export const ECOSYSTEM_PLATFORM_NAME = 'redbtn';

export function platformName(brand: Brand): string {
  return brand.auth.mode === 'isolated' ? brand.product.name : ECOSYSTEM_PLATFORM_NAME;
}
