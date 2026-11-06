import { NextResponse } from 'next/server';

import { isValidSlug, profilePatchSchema, type CalendarSelection } from '@redmeet/core';

import { badRequest, gate } from '@/lib/api-gate';
import { listCalendars, listGoogleAccounts } from '@/lib/calendar';
import { resolveHostCalendarToken } from '@/lib/calendar-auth';
import { getDb } from '@/lib/db';
import { ensureHost, hostPrivateJson } from '@/lib/hosts';
import { logger } from '@/lib/log';
import { MeetHost, type MeetHostDoc } from '@/models/meet-host';

export const dynamic = 'force-dynamic';

/** GET /api/v0/profile, the caller's host profile. */
export async function GET(request: Request): Promise<NextResponse> {
  const gated = await gate(request);
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  return NextResponse.json({ host: hostPrivateJson(host) });
}

/**
 * Re-prove and store a calendar selection. Every connectionId in it
 * must come from google_accounts_list under the host's OWN stored
 * credential, and every calendarId must exist on that connection's
 * live calendar list; the stored email and summary are taken from
 * those listings, never from the request. This is the same ownership
 * discipline as the connect flow, applied to selections: a caller can
 * narrow or widen their own selection, but can never point their host
 * at a connection or calendar that is not theirs.
 */
async function applyCalendarSelection(
  host: MeetHostDoc & { save: () => Promise<unknown> },
  selection: CalendarSelection,
): Promise<{ error: string; status: number } | null> {
  if (selection.calendars.length === 0) {
    // An empty selection is the unmigrated legacy state, so it cannot
    // also mean "block on nothing": a connected host keeps at least
    // one ticked calendar, and disconnecting is how they have none.
    return { error: 'Tick at least one calendar to block slots, or disconnect your calendar.', status: 400 };
  }
  const token = await resolveHostCalendarToken(host);
  if (!token) {
    return { error: 'Connect your calendar first, then pick which calendars block slots.', status: 400 };
  }
  let accounts;
  try {
    accounts = await listGoogleAccounts(token);
  } catch (error) {
    logger.warn('selection accounts list failed', { error: String(error) });
    return { error: 'Could not verify your google accounts right now. Try again.', status: 502 };
  }
  const accountById = new Map(accounts.map((a) => [a.connectionId, a]));
  for (const entry of selection.calendars) {
    if (!accountById.has(entry.connectionId)) {
      return {
        error: 'One of those google accounts is not linked under your redbtn credential.',
        status: 403,
      };
    }
  }

  const verified: MeetHostDoc['calendarSelection'] = [];
  const seen = new Set<string>();
  const involved = [...new Set(selection.calendars.map((e) => e.connectionId))];
  for (const connectionId of involved) {
    let calendars;
    try {
      calendars = await listCalendars({ token, connectionId });
    } catch (error) {
      logger.warn('selection calendar list failed', { error: String(error) });
      return { error: 'Could not verify the calendars on one of your accounts. Try again.', status: 502 };
    }
    const byId = new Map(calendars.map((c) => [c.id, c]));
    for (const entry of selection.calendars.filter((e) => e.connectionId === connectionId)) {
      const cal = byId.get(entry.calendarId);
      if (!cal) {
        return { error: 'One of those calendars no longer exists on its account.', status: 400 };
      }
      const key = `${connectionId}|${cal.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      verified.push({
        connectionId,
        calendarId: cal.id,
        email: accountById.get(connectionId)?.email ?? '',
        summary: cal.summary,
      });
    }
  }

  let writeTarget = selection.writeTarget;
  if (verified.length === 0) {
    writeTarget = null;
  } else if (
    !writeTarget ||
    !verified.some(
      (e) => e.connectionId === writeTarget!.connectionId && e.calendarId === writeTarget!.calendarId,
    )
  ) {
    writeTarget = { connectionId: verified[0]!.connectionId, calendarId: verified[0]!.calendarId };
  }

  host.calendarSelection = verified;
  host.calendarWriteTarget = writeTarget;
  host.calendarIds = [...new Set(verified.map((e) => e.calendarId))];
  host.googleConnectionIds = accounts.map((a) => a.connectionId);
  return null;
}

/** PATCH /api/v0/profile, update slug, name, bio, colour, calendars. */
export async function PATCH(request: Request): Promise<NextResponse> {
  const gated = await gate(request, { mutate: true });
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body must be JSON');
  }
  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? 'Invalid profile update');
  }
  const patch = parsed.data;

  if (patch.slug !== undefined) {
    if (!isValidSlug(patch.slug)) {
      return badRequest('That slug is not available. Use lowercase letters, numbers and dashes, and avoid app words like app or api.');
    }
    if (patch.slug !== host.slug) {
      await getDb();
      const taken = await MeetHost.exists({ slug: patch.slug, _id: { $ne: host._id } });
      if (taken) return badRequest('That slug is already taken');
    }
  }

  if (patch.calendarSelection !== undefined) {
    const failure = await applyCalendarSelection(host, patch.calendarSelection);
    if (failure) {
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }
  }

  Object.assign(host, {
    ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
    ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
    ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    // Connection ids are not patchable here on purpose: they only
    // land on a host through /api/v0/calendar/connect, which proves
    // ownership, and selections are re-proven above on every save.
  });
  await host.save();
  return NextResponse.json({ host: hostPrivateJson(host) });
}
