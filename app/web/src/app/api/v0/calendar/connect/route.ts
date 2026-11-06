import { NextResponse } from 'next/server';

import { calendarConnectSchema } from '@redmeet/core';

import { badRequest, gate } from '@/lib/api-gate';
import { listCalendars, listGoogleAccounts } from '@/lib/calendar';
import { ensureHost, hostPrivateJson } from '@/lib/hosts';
import { logger } from '@/lib/log';
import { whoami } from '@/lib/redbtn';
import { credentialAad, sealSecret, sealingConfigured } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v0/calendar/connect, step 2 of connecting a calendar.
 *
 * Stores the host's own gateway credential, sealed at rest. Ownership
 * is proven twice over before anything is written:
 *
 *   1. whoami: the token's owner is the signed-in host.
 *   2. The chosen connectionId is re-listed under THAT token and must
 *      be in the list. An id from anywhere else (another user's list,
 *      a guess, the old app level default) is refused, so a host can
 *      never be pointed at a connection that is not theirs.
 *
 * The chosen account becomes the host's default connection, and EVERY
 * account in that same listing is recorded as a usable connection:
 * the calendar selection spans all of the host's linked google
 * accounts, and each id in it was proven under this same token here.
 * The starting selection is the default connection's primary
 * calendar; the host widens it in Settings.
 *
 * The raw token is never logged; only its sealed form is stored.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const gated = await gate(request, { mutate: true });
  if (!gated.ok) return gated.response;
  if (!sealingConfigured()) {
    return NextResponse.json(
      { error: 'Calendar connections are not configured on the server yet.' },
      { status: 503 },
    );
  }
  const host = await ensureHost(gated.user);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body must be JSON');
  }
  const parsed = calendarConnectSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? 'Check the form and try again');
  }
  const { token, connectionId } = parsed.data;

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

  let accounts;
  try {
    accounts = await listGoogleAccounts(token);
  } catch (error) {
    logger.warn('calendar connect list failed', { error: String(error) });
    return badRequest('Could not list your google accounts with that token.');
  }
  const chosen = accounts.find((a) => a.connectionId === connectionId);
  if (!chosen) {
    return NextResponse.json(
      { error: 'That google account is not linked under this token. Pick one from the list.' },
      { status: 403 },
    );
  }

  host.gatewayCredential = sealSecret(token, credentialAad(String(host._id)));
  host.googleConnectionId = chosen.connectionId;
  host.googleConnectionEmail = chosen.email;
  host.googleConnectionIds = accounts.map((a) => a.connectionId);
  host.calendarConnectedAt = new Date();

  // The starting selection is the default connection's primary
  // calendar, as the write target too. Settings widens it across all
  // of the host's connections from here.
  let calendars: Awaited<ReturnType<typeof listCalendars>> = [];
  try {
    calendars = await listCalendars({ token, connectionId: chosen.connectionId });
  } catch (error) {
    logger.warn('calendar list after connect failed', { error: String(error) });
  }
  const primary = calendars.find((c) => c.primary) ?? calendars[0];
  if (primary) {
    host.calendarSelection = [
      {
        connectionId: chosen.connectionId,
        calendarId: primary.id,
        email: chosen.email,
        summary: primary.summary,
      },
    ];
    host.calendarWriteTarget = { connectionId: chosen.connectionId, calendarId: primary.id };
    host.calendarIds = [primary.id];
  } else {
    host.calendarSelection = [];
    host.calendarWriteTarget = null;
    host.calendarIds = ['primary'];
  }
  await host.save();

  return NextResponse.json({
    host: hostPrivateJson(host),
    calendars,
  });
}

/**
 * DELETE /api/v0/calendar/connect, disconnect the calendar. The
 * sealed credential, the connection set, and the selection are
 * wiped; availability returns to own-bookings-only until the host
 * connects again.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  const gated = await gate(request, { mutate: true });
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  host.gatewayCredential = null;
  host.googleConnectionId = null;
  host.googleConnectionEmail = null;
  host.googleConnectionIds = [];
  host.calendarSelection = [];
  host.calendarWriteTarget = null;
  host.calendarIds = ['primary'];
  host.calendarConnectedAt = null;
  await host.save();
  return NextResponse.json({ host: hostPrivateJson(host) });
}
