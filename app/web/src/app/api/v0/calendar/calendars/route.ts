import { NextResponse } from 'next/server';

import { gate } from '@/lib/api-gate';
import { listCalendars } from '@/lib/calendar';
import { resolveHostCalendarAuth } from '@/lib/calendar-auth';
import { ensureHost } from '@/lib/hosts';
import { logger } from '@/lib/log';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v0/calendar/calendars, the calendars on the signed-in
 * host's OWN connected google account, for the settings picker. A
 * host with no connected calendar gets an honest empty answer, never
 * another host's calendars.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const gated = await gate(request);
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  const auth = await resolveHostCalendarAuth(host);
  if (!auth) {
    return NextResponse.json({ calendars: [], connected: false });
  }
  try {
    const calendars = await listCalendars(auth);
    return NextResponse.json({ calendars, connected: true });
  } catch (error) {
    logger.warn('host calendar list failed', { error: String(error) });
    return NextResponse.json({ calendars: [], connected: true, error: 'Calendar list unavailable right now' });
  }
}
