import { NextResponse } from 'next/server';

import { gate } from '@/lib/api-gate';
import { listGoogleAccounts } from '@/lib/calendar';
import { resolveHostCalendarAuth } from '@/lib/calendar-auth';
import { ensureHost } from '@/lib/hosts';
import { logger } from '@/lib/log';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v0/google-accounts, the google accounts linked under the
 * signed-in host's OWN gateway credential, for settings display. A
 * host with no credential gets `connected: false` and an empty list;
 * this route never falls back to a platform credential, which is how
 * the v1 build silently showed George's accounts to everyone.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const gated = await gate(request);
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  const auth = await resolveHostCalendarAuth(host);
  if (!auth) {
    return NextResponse.json({ accounts: [], connected: false });
  }
  try {
    const accounts = await listGoogleAccounts(auth.token);
    return NextResponse.json({ accounts, connected: true });
  } catch (error) {
    logger.warn('google accounts list failed', { error: String(error) });
    return NextResponse.json({ accounts: [], connected: true, error: 'Calendar connection unavailable' });
  }
}
