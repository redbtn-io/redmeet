import { NextResponse } from 'next/server';

import { gate } from '@/lib/api-gate';
import { listCalendarsByConnection } from '@/lib/calendar';
import { resolveHostCalendarSelection, resolveHostCalendarToken } from '@/lib/calendar-auth';
import { ensureHost, hostPrivateJson } from '@/lib/hosts';
import { logger } from '@/lib/log';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v0/calendar/calendars, the settings calendar picker's data.
 *
 * Every google connection linked under the signed-in host's OWN
 * credential, each with its calendars, grouped by account, plus the
 * host's stored selection and write target. Connections come from
 * google_accounts_list under the host's credential and each list call
 * carries that connection's header; nothing here ever touches another
 * host's accounts. A host with no connected calendar gets an honest
 * empty answer, never another host's calendars.
 *
 * Resolving the selection first also forward-migrates a legacy
 * single-connection record, so what the picker shows ticked is what
 * availability will actually use.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const gated = await gate(request);
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  const token = await resolveHostCalendarToken(host);
  if (!token) {
    return NextResponse.json({ accounts: [], selection: [], writeTarget: null, connected: false });
  }
  await resolveHostCalendarSelection(host);
  try {
    const accounts = await listCalendarsByConnection(token);
    const view = hostPrivateJson(host);
    return NextResponse.json({
      accounts,
      selection: view.calendarSelection,
      writeTarget: view.calendarWriteTarget,
      connected: true,
    });
  } catch (error) {
    logger.warn('host calendar connections list failed', { error: String(error) });
    const view = hostPrivateJson(host);
    return NextResponse.json({
      accounts: [],
      selection: view.calendarSelection,
      writeTarget: view.calendarWriteTarget,
      connected: true,
      error: 'Calendar list unavailable right now',
    });
  }
}
