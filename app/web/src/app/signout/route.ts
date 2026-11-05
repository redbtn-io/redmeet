import { clearSessionCookies } from '@redbtn/redauth/next';

import { getConfig } from '@/lib/config';

/**
 * Sign out of the ecosystem session.
 *
 * **SIGN-OUT IS POST ONLY, AND THAT IS LOAD BEARING.**
 *
 * Next prefetches every in-viewport `<Link>`, so a sign-out reached from one
 * fires `GET /signout?_rsc=...` the moment any signed-in page renders, and the
 * response carries `red_session=; Max-Age=0; Domain=.redbtn.io`. Merely LOOKING
 * at a page would sign the person out of every redApp at once. Another app in
 * this estate shipped that defect, which is why the account menu holds a form
 * and not a link.
 *
 * `clearSessionCookies` returns TWO Set-Cookie headers on purpose: the shared
 * `.redbtn.io` cookie and a host-only one. A stale host-only cookie shadows the
 * domain cookie, so clearing one of them leaves the caller apparently signed in.
 * Each is appended RAW rather than set through the cookies API, because mixing
 * the two makes Next re-serialize the list and drop one.
 */
export const dynamic = 'force-dynamic';

/** 303, so the redirect that follows is unambiguously a GET. */
export async function POST(): Promise<Response> {
  const config = getConfig();
  const headers = new Headers({ Location: config.accountsUrl, 'cache-control': 'no-store' });
  for (const cookie of clearSessionCookies()) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

/** Deliberately inert: sends you home and clears nothing. */
export async function GET(): Promise<Response> {
  return new Response(null, {
    status: 303,
    headers: { Location: '/', 'cache-control': 'no-store' },
  });
}
