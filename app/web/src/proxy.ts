import { NextResponse, type NextRequest } from 'next/server';

import { resolveEdgeSession, resolveEdgeSessionLive } from '@redbtn/redauth/edge';
import { authPlan, deploymentBrand, resolveBrand, signInUrl } from '@redbtn/redlabel';
import { REGISTRY } from '@redbtn/redlabel/brands';

/**
 * The gate: redirect, and nothing else.
 *
 * **`proxy.ts`, not `middleware.ts`.** Both names work on Next 16.3 today, but
 * `middleware` is deprecated with a scheduled removal, and the failure mode on
 * the day it goes is a gate file that EXISTS AND NEVER RUNS.
 *
 * Because it is Node, it CAN reach Mongo. It must not: no model import, no
 * mongoose import. The authoritative check is `resolveSession` in the route,
 * because the edge degrades OPEN when accounts cannot answer.
 */
export const PATHNAME_HEADER = 'x-redmeet-pathname';
export const NONCE_HEADER = 'x-redmeet-nonce';

/** Public surface. `/` is the landing page with the sign-in button. */
const ALWAYS_OPEN = ['/', '/api/health'];

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt).*)'],
};

/**
 * First segments that belong to the app itself. Host slugs can never be
 * one of these (@redmeet/core RESERVED_SLUGS keeps it so), which is what
 * lets the proxy tell a public booking page from an app route by shape.
 */
const RESERVED_FIRST = new Set(['app', 'api', 'signout']);

function isExempt(pathname: string): boolean {
  if (ALWAYS_OPEN.includes(pathname)) return true;
  // Public booking API: profile lookup, availability, booking creation.
  // The routes do their own validation; there is no session to gate on.
  if (pathname.startsWith('/api/public/')) return true;
  // PWA install surface: the manifest and icons must be fetchable without a
  // session (Chrome fetches them during install; iOS fetches the touch icon
  // when adding to the home screen). Static brand assets, nothing sensitive.
  if (pathname === '/manifest.webmanifest') return true;
  if (/^\/icons\/[A-Za-z0-9_.-]+\.(png|svg)$/.test(pathname)) return true;
  // Brand assets (redlabel): the mark, the favicons, the touch icon. The
  // canonical adoption guide is explicit that this exemption is not
  // optional: without it the gate 302s a signed-out visitor's brand mark
  // and the iOS touch icon to the sign-in host, a broken image on the
  // landing page and an uninstallable PWA.
  if (pathname.startsWith('/brand/')) return true;
  if (pathname === '/apple-touch-icon.png') return true;
  // Public booking pages: /<slug> and /<slug>/<meeting>. Guests have no
  // account, that is the point of the product. A first segment from
  // RESERVED_FIRST is an app route and stays gated.
  const segments = pathname.split('/').filter(Boolean);
  if ((segments.length === 1 || segments.length === 2) && !RESERVED_FIRST.has(segments[0]!)) {
    return true;
  }
  return false;
}

function mintNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
}

/**
 * The LiveKit origins the browser must be allowed to reach from
 * the join page (Epic 2): the signaling WebSocket (wss) and the
 * HTTP endpoint on the same host. Read from the same LIVEKIT_URL
 * the server mints against, so the policy and the tokens can
 * never point at different servers. Absent config means no extra
 * origins: the room features fail closed server side anyway.
 */
function liveKitConnectSrc(): string[] {
  const raw = (process.env.LIVEKIT_URL ?? '').trim();
  if (!raw) return [];
  try {
    const url = new URL(raw);
    return [url.origin, `wss://${url.host}`];
  } catch {
    return [];
  }
}

function contentSecurityPolicy(_nonce: string): string {
  // Next.js App Router emits inline <script> tags for the RSC payload
  // (self.__next_f.push) WITHOUT nonces — a nonce in script-src makes
  // browsers IGNORE 'unsafe-inline', silently disabling the directive meant
  // to allow the Flight data. So: 'self' + 'unsafe-inline', no nonce.
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${liveKitConnectSrc().join(' ')}`.trim(),
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Continue, telling the Node runtime which path this is, under a fresh nonce. */
function proceed(request: NextRequest, pathname: string): NextResponse {
  const headers = new Headers(request.headers);
  // SET, never read from the caller, so a client-supplied header of the same
  // name is overwritten rather than believed.
  headers.set(PATHNAME_HEADER, pathname);
  const nonce = mintNonce();
  headers.set(NONCE_HEADER, nonce);
  const csp = contentSecurityPolicy(nonce);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  if (isExempt(pathname)) return proceed(request, pathname);

  // Cookie name and sign-in target come from the DEPLOYMENT brand, which is
  // configuration. The return URL is built from the brand's origin, never the
  // request host: behind redrouter-proxy the container sees its own bind
  // address, and a return URL derived from that sends the browser nowhere.
  const hostBrand = resolveBrand(
    request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
    REGISTRY,
  );
  const plan = authPlan(deploymentBrand(REGISTRY));
  // v0 serves the ecosystem brand only; the isolated branch is dead code.
  if (plan.mode !== 'ecosystem') throw new Error('redMeet requires ecosystem auth');

  // Fail closed on a missing secret: an app with no verify key admits nobody.
  const jwtSecret = (process.env[plan.secretEnv] ?? '').replace(/^"|"$/g, '');

  if (jwtSecret) {
    const payload = await resolveEdgeSession(request, { jwtSecret });
    if (payload) {
      const token = request.cookies.get(plan.cookieName)?.value ?? '';
      const live = await resolveEdgeSessionLive({
        token,
        accountsUrl: plan.accountsUrl,
        cacheSeconds: 60,
        // Degrade to the JWT gate when accounts cannot answer: accounts being
        // down must not take every app down with it. The Node-side check in
        // `resolveSession` is the authoritative one.
        failClosed: false,
      });
      if (live) return proceed(request, pathname);
    }
  }

  // An API call gets a 401 it can act on; a browser gets sent to sign in.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Not authenticated', code: 'unauthenticated' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.redirect(signInUrl(hostBrand, `${pathname}${search}`));
}
