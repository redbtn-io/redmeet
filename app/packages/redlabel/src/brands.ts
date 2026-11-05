/**
 * Brand registry, v0. Canonical implementation: redscan's packages/redlabel.
 *
 * Single ecosystem brand until multi-tenant brands land. The `auth` block is
 * the source of truth for the SSO seam: cookie name, accounts URL, secret env.
 */
export interface BrandAuth {
  mode: 'ecosystem';
  cookieName: 'red_session';
  cookieDomain: '.redbtn.io';
  accountsUrl: string;
  secretEnv: 'JWT_SECRET';
}

export interface Brand {
  id: string;
  name: string;
  origin: string;
  auth: BrandAuth;
  /** The brand this deployment serves. Exactly one registry entry sets this. */
  deployment?: boolean;
}

export const REGISTRY: Record<string, Brand> = {
  'meet.redbtn.io': {
    id: 'redmeet',
    name: 'redMeet',
    origin: 'https://meet.redbtn.io',
    auth: {
      mode: 'ecosystem',
      cookieName: 'red_session',
      cookieDomain: '.redbtn.io',
      accountsUrl: 'https://accounts.redbtn.io',
      secretEnv: 'JWT_SECRET',
    },
    deployment: true,
  },
};

/** Lowercase, strip port. */
export function normalizeHost(raw: string | null | undefined): string {
  return (raw ?? '').split(',')[0]!.trim().toLowerCase().split(':')[0]!;
}

/**
 * Resolve a request host to its brand.
 *
 * v0 falls back to the deployment brand for unknown hosts (the redrouter
 * front may present the container bind address or a not-yet-registered
 * alias). The brand only selects the sign-in return origin — it is
 * configuration, not authorization — so the fallback cannot widen access.
 * Strict allowlist lands with the canonical redlabel port.
 */
export function resolveBrand(host: string | null | undefined, registry: Record<string, Brand>): Brand {
  return registry[normalizeHost(host)] ?? deploymentBrand(registry);
}

/** The brand this deployment serves. */
export function deploymentBrand(registry: Record<string, Brand>): Brand {
  const found = Object.values(registry).find((b) => b.deployment);
  if (!found) throw new Error('No deployment brand in registry');
  return found;
}

/** Back-compat for session.ts's boot assertion. */
export function assertDeploymentBrand(host: string): Brand {
  return resolveBrand(host, REGISTRY);
}
