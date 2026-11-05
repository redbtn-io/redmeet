/**
 * The auth seam: data plus pure functions, no `@redbtn/redauth` dependency.
 *
 * Ported from redscan's packages/redlabel/src/auth.ts (the estate canonical).
 * redLabel never reads a secret — it carries the NAME; `process.env[plan.secretEnv]`
 * is the app's line of code, in the app's server-only module.
 */
import type { Brand } from './brands';

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

/** Structural input shape — Brand's ecosystem auth is assignable to this. */
export interface BrandAuthInput {
  mode: string;
  cookieName: string;
  cookieDomain: string;
  accountsUrl: string | null;
  secretEnv: string;
}

/**
 * `brand.auth`, widened to a stable shape.
 *
 * v0 serves the ecosystem brand only. The isolated branch is dropped until
 * the canonical redlabel port — carrying it as dead code just fights the
 * type checker, as the last three builds demonstrated.
 */
export function authPlan(brand: { auth: BrandAuthInput }): AuthPlan {
  const auth = brand.auth;
  if (auth.mode !== 'ecosystem') throw new Error('redMeet v0 requires ecosystem auth');
  return {
    mode: 'ecosystem',
    cookieName: 'red_session',
    cookieDomain: '.redbtn.io',
    accountsUrl: auth.accountsUrl ?? 'https://accounts.redbtn.io',
    secretEnv: 'JWT_SECRET',
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
 *
 * The return URL is built from `brand.origin`, which is CONFIGURATION, never
 * from the request host: behind redrouter-proxy the container sees its own bind
 * address as the host, and a return URL derived from that sends the browser
 * nowhere. It is also the field accounts' return-to boundary is anchored on.
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
