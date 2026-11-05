/**
 * Client-safe sign-in URL builder.
 *
 * `signInUrl` + the brand registry are pure (no secrets — the JWT secret
 * name is read server-side only), so this is safe to import from client
 * components. Used when an API call fails with 401 mid-session: instead of
 * a dead-end "session expired" string, the UI can offer "Sign in again"
 * with a return trip back to the current page.
 */
import { signInUrl } from '@redbtn/redlabel/auth';
import { REGISTRY, deploymentBrand } from '@redbtn/redlabel/brands';

/** Absolute accounts URL that returns to `next` (defaults to the current page). */
export function signInHref(next?: string): string {
  const fallback =
    typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : '/app';
  return signInUrl(deploymentBrand(REGISTRY), next ?? fallback);
}
