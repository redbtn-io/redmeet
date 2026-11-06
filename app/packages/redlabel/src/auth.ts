/**
 * The auth seam: data plus pure functions, and no `@redbtn/redauth` dependency.
 *
 * redauth is a server library with a mongoose surface and a factory that mints
 * sessions. Pulling it into a package `./ui` imports from would drag it into the
 * client graph and make redLabel un-adoptable by anything that does not use
 * redbtn auth. So the shapes below are declared STRUCTURALLY and redauth is
 * never imported.
 *
 * **redLabel never reads a secret.** It carries the NAME.
 * `process.env[plan.secretEnv]` is the app's line of code, in the app's
 * server-only module.
 */
import type { Brand } from './brand';

export type AuthPlan =
  | {
      mode: 'ecosystem';
      cookieName: 'red_session';
      cookieDomain: '.redbtn.io';
      accountsUrl: string;
      secretEnv: 'JWT_SECRET';
    }
  | {
      mode: 'isolated';
      cookieName: string;
      cookieDomain: '';
      accountsUrl: null;
      secretEnv: string;
    };

/** `brand.auth`, widened to a stable shape. */
export function authPlan(brand: Brand): AuthPlan {
  const auth = brand.auth;
  if (auth.mode === 'ecosystem') {
    return {
      mode: 'ecosystem',
      cookieName: auth.cookieName,
      cookieDomain: auth.cookieDomain,
      accountsUrl: auth.accountsUrl,
      secretEnv: auth.secretEnv,
    };
  }
  return {
    mode: 'isolated',
    cookieName: auth.cookieName,
    cookieDomain: auth.cookieDomain,
    accountsUrl: null,
    secretEnv: auth.secretEnv,
  };
}

const MAX_NEXT_LENGTH = 512;
// The C0 control range plus DEL: header-splitting and log-forging territory.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * A safe same-app relative path, or `/`.
 *
 * A single leading slash means "this app". A doubled slash, or a slash followed
 * by a backslash, is how a path check gets talked into an absolute URL on
 * somebody else's origin.
 */
function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (raw.length > MAX_NEXT_LENGTH) return '/';
  if (CONTROL_CHARS.test(raw)) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}

/**
 * The absolute sign-in URL.
 *
 * Ecosystem: `accountsUrl` with `?next=<absolute URL under brand.origin>`.
 * Isolated: `${brand.origin}/signin?next=<relative path>`.
 *
 * The return URL is built from `brand.origin`, which is CONFIGURATION, never
 * from the request host: behind redrouter-proxy the container sees its own bind
 * address as the host, and a return URL derived from that sends the browser
 * nowhere. It is also the field accounts' return-to boundary is anchored on,
 * which is why there is no dev-only escape hatch here.
 */
export function signInUrl(brand: Brand, next?: string | null): string {
  const plan = authPlan(brand);
  const path = safeNext(next);
  if (plan.mode === 'ecosystem') {
    const absolute = new URL(path, brand.origin).toString();
    return `${plan.accountsUrl}/?next=${encodeURIComponent(absolute)}`;
  }
  return `${brand.origin}/signin?next=${encodeURIComponent(path)}`;
}

/** The exact object shape `@redbtn/redauth`'s `createRedAuth({ email })` accepts. */
export interface EmailBranding {
  appName: string;
  accentColor: string;
  tagline?: string;
  logoUrl?: string;
  logoWidth?: number;
  footerText?: string;
  buttonStyle?: Record<string, string>;
}

export interface EmailTransport {
  host: string;
  port: number;
  user: string;
  pass: string;
  devMode?: boolean;
}

/**
 * TOTAL: when `email.footerText` is null it synthesizes the copyright line.
 *
 * redauth's template falls back to a hardcoded "RedBtn. All rights reserved."
 * when the field is absent, so a brand that leaves it out sends redbtn's
 * copyright to a reseller's users in the one email every single user receives
 * before they ever see the app. `undefined` never leaves this function.
 */
export function brandEmailBranding(brand: Brand): EmailBranding {
  const footerText =
    brand.email.footerText ??
    `© ${new Date().getFullYear()} ${brand.legal.copyrightHolder ?? brand.legal.companyName}. All rights reserved.`;
  const branding: EmailBranding = {
    appName: brand.email.appName,
    accentColor: brand.email.accentColor,
    footerText,
    logoWidth: brand.email.logoWidth,
  };
  if (brand.product.tagline !== null) branding.tagline = brand.product.tagline;
  if (brand.email.logoUrl !== null) branding.logoUrl = brand.email.logoUrl;
  return branding;
}

/**
 * The WHOLE email config, not just the branding half.
 *
 * `RedAuthEmailConfig` is `{host, port, user, pass, from, devMode?, branding?}`:
 * `from` is a SIBLING of `branding`, not inside it, so a function that returns
 * only the branding half leaves the envelope sender to the container, which for
 * an isolated reseller is redbtn's mailbox on a reseller's magic link.
 *
 * There is no `fromName`: redauth composes the header itself as
 * `"${branding.appName}" <${emailConfig.from}>`, so two names for one identity
 * is how a reseller's email says one product in the sender and another in the
 * body.
 */
export function brandEmailConfig(
  brand: Brand,
  transport: EmailTransport,
): EmailTransport & { from: string; branding: EmailBranding } {
  return { ...transport, from: brand.email.fromAddress, branding: brandEmailBranding(brand) };
}
