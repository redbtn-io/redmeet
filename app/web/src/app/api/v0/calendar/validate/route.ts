import { NextResponse } from 'next/server';

import { calendarValidateSchema } from '@redmeet/core';

import { badRequest, gate } from '@/lib/api-gate';
import { listGoogleAccounts } from '@/lib/calendar';
import { logger } from '@/lib/log';
import { whoami } from '@/lib/redbtn';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v0/calendar/validate, step 1 of connecting a calendar.
 *
 * The signed-in host pastes their OWN redbtn personal access token.
 * Two proofs happen before anything is offered back:
 *
 *   1. The token's owner (hub whoami) IS the signed-in host. A token
 *      belonging to anyone else is refused outright.
 *   2. The google accounts are listed with THAT token, so every
 *      connection id the host can pick in step 2 is one their own
 *      credential owns.
 *
 * The token is never stored or logged by this route.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const gated = await gate(request, { mutate: true });
  if (!gated.ok) return gated.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body must be JSON');
  }
  const parsed = calendarValidateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Paste your redbtn personal access token');
  }
  const { token } = parsed.data;

  const identity = await whoami(token);
  if (!identity) {
    return badRequest('That token was not accepted. Check it and try again.');
  }
  if (identity.userId !== gated.user.userId) {
    return NextResponse.json(
      { error: 'That token belongs to a different redbtn account. Paste a token created while signed in as you.' },
      { status: 403 },
    );
  }

  try {
    const accounts = await listGoogleAccounts(token);
    if (accounts.length === 0) {
      return NextResponse.json({
        accounts: [],
        error:
          'No google accounts are linked to your redbtn account yet. Connect Google first, then come back.',
      });
    }
    return NextResponse.json({ accounts });
  } catch (error) {
    logger.warn('calendar validate list failed', { error: String(error) });
    return badRequest(
      'Could not list your google accounts with that token. The token needs the Connections scope (or full access).',
    );
  }
}
