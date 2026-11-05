import { timingSafeEqual } from 'node:crypto';
import 'server-only';

import { createRedAuth } from '@redbtn/redauth';
import { assertDeploymentBrand } from '@redbtn/redlabel/brands';

import { getConfig } from '@/lib/config';
import { logger } from '@/lib/log';

/**
 * Who is asking.
 *
 * **redMeet MINTS NOTHING.** accounts.redbtn.io is the only place a redbtn
 * session is created; this app verifies the shared cookie it issued. If you
 * reach for `createSession` here, the answer is upstream.
 *
 * Two gates, both required on every call including reads:
 *
 *   1. the JWT verifies against the fleet secret, and
 *   2. the device session named by `payload.sid` still exists.
 *
 * Fails closed on a missing secret: an app with no JWT_SECRET admits nobody,
 * rather than admitting everybody.
 *
 * v0 note: `assertDeploymentAuth` (the redlabel deployment-auth assertion)
 * lands with the canonical redlabel port. The brand assertion below uses the
 * v0 shim registry.
 */

export interface SessionUser {
  userId: string;
  email: string;
  /** redauth AccountLevel. ADMIN is 0, so never test this for truthiness. */
  accountLevel: number;
  sid: string;
}

export type SessionResult =
  | {
      ok: true;
      user: SessionUser;
      /**
       * `verified`: the device session was found and is live.
       * `degraded`: the session store could not be reached, so the JWT gate is
       * all that held. Anything carrying tenant code or triggering a deploy
       * fails closed in this state.
       */
      liveness: 'verified' | 'degraded';
    }
  | { ok: false; status: 401 | 503; error: string };

let auth: ReturnType<typeof createRedAuth> | null = null;
let checked = false;

/**
 * The per-request auth handle.
 *
 * The deployment assertion runs HERE, once, on the first request, and never
 * at module load: `next build` collects page data by importing this module with
 * no runtime secrets and no request scope, so a module-scope assertion fails the
 * Docker build on a missing secret rather than catching a misconfiguration.
 */
export function getAuth(): ReturnType<typeof createRedAuth> {
  if (!checked) {
    const host = new URL(getConfig().baseUrl || 'https://meet.redbtn.io').host;
    assertDeploymentBrand(host);
    checked = true;
  }
  if (!auth) {
    const config = getConfig();
    if (!config.authMongoUri) throw new Error('AUTH_MONGODB_URI is not configured');
    if (!config.jwtSecret) throw new Error('JWT_SECRET is not configured');
    auth = createRedAuth({
      mongoUri: config.authMongoUri,
      jwtSecret: config.jwtSecret,
      appName: 'redmeet',
      baseUrl: config.baseUrl,
      cookieName: config.cookieName,
      cookieDomain: config.cookieDomain,
    });
  }
  return auth;
}

/** Test seam. Resets the memoised redauth instance and the boot assertion. */
export function resetAuth(): void {
  auth = null;
  checked = false;
}

/** Resolve the caller from the request, proving the session is still live. */
export async function resolveSession(request: Request): Promise<SessionResult> {
  const config = getConfig();
  if (!config.jwtSecret || !config.authMongoUri) {
    return { ok: false, status: 503, error: 'Authentication is not configured' };
  }

  let payload: {
    userId?: string;
    email?: string;
    sid?: string;
    accountLevel?: number;
  } | null;
  try {
    payload = getAuth().getUserFromHeaders({
      cookie: request.headers.get('cookie'),
      authorization: request.headers.get('authorization'),
    });
  } catch {
    return { ok: false, status: 503, error: 'Authentication is not configured' };
  }
  if (!payload?.userId || !payload.email) {
    return { ok: false, status: 401, error: 'Not authenticated' };
  }
  // A stateless JWT with no `sid` predates device sessions or was minted by a
  // service. It is not a browser session and never gets one's privileges.
  if (!payload.sid) {
    return { ok: false, status: 401, error: 'Session is not device-bound' };
  }

  const user: SessionUser = {
    userId: payload.userId,
    email: payload.email,
    accountLevel: typeof payload.accountLevel === 'number' ? payload.accountLevel : 4,
    sid: payload.sid,
  };

  try {
    const session = await getAuth().getSessionStatus(payload.sid);
    if (!session || session.userId !== payload.userId) {
      return { ok: false, status: 401, error: 'Session has been revoked' };
    }
    return { ok: true, user, liveness: 'verified' };
  } catch (error) {
    // The session store is unreachable. The JWT still verified, so this is an
    // outage, not an impostor: ordinary routes continue and the fail-closed
    // paths turn this into a 503.
    logger.error('device session lookup failed', { error: String(error) });
    return { ok: true, user, liveness: 'degraded' };
  }
}

/** Constant-time comparison for service credentials. */
export function secretEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
