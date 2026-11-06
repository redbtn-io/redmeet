import 'server-only';
import { NextResponse } from 'next/server';

import { deploymentBrand } from '@redbtn/redlabel';
import { REGISTRY } from '@redbtn/redlabel/brands';
import type { SessionResult, SessionUser } from '@/lib/session';
import { resolveSession } from '@/lib/session';

/**
 * Session gate for the private API routes.
 *
 * The proxy already verified the JWT at the edge; this is the authoritative
 * Node-side check. Mutations require a LIVE session (fail closed); reads
 * tolerate the degraded state. Every private route is owner-scoped: the
 * gate hands back the caller, and routes filter by `ownerId` on it.
 *
 * There is deliberately NO beta gate here (redSites has one): redMeet is
 * a front door product, any signed-in redbtn user may claim a slug.
 */
export async function gate(
  request: Request,
  opts: { mutate?: boolean } = {},
): Promise<{ ok: true; user: SessionUser } | { ok: false; response: NextResponse }> {
  const session: SessionResult = await resolveSession(request);
  if (!session.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: session.error }, { status: session.status }),
    };
  }

  if (opts.mutate && session.liveness !== 'verified') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Session store unreachable; changes are disabled right now' },
        { status: 503 },
      ),
    };
  }
  if (opts.mutate) {
    // CSRF: mutations ride the shared red_session cookie, so a cross-site
    // page must not be able to POST them. Same-origin fetches from the app
    // always carry a matching Origin (or Sec-Fetch-Site: same-origin).
    const origin = request.headers.get('origin');
    const secFetchSite = request.headers.get('sec-fetch-site');
    const allowed = new Set([deploymentBrand(REGISTRY).origin, new URL(request.url).origin]);
    if (origin) {
      if (!allowed.has(origin)) {
        return {
          ok: false,
          response: NextResponse.json({ error: 'Cross-origin request refused' }, { status: 403 }),
        };
      }
    } else if (secFetchSite && !['same-origin', 'none'].includes(secFetchSite)) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 }),
      };
    }
  }
  return { ok: true, user: session.user };
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = 'Not found'): NextResponse {
  return NextResponse.json({ error: message, code: 'not_found' }, { status: 404 });
}
