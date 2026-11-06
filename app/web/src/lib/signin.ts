/**
 * Sign-in URL builder (server-side).
 *
 * `signInUrl` itself is pure, but the brand registry it resolves through
 * is `server-only` in canonical redlabel: a client component that imported
 * it would ship every brand's config to the browser, so `./brands` refuses
 * at build time. Callers on the server use this helper; a client component
 * that needs a sign-in URL receives it from a server parent as a prop,
 * which is the canonical pattern.
 */
import { deploymentBrand, signInUrl } from '@redbtn/redlabel';
import { REGISTRY } from '@redbtn/redlabel/brands';

/** Absolute accounts URL that returns to `next` (defaults to the app). */
export function signInHref(next?: string): string {
  return signInUrl(deploymentBrand(REGISTRY), next ?? '/app');
}
