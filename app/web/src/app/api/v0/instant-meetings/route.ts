import { NextResponse } from 'next/server';

import { badRequest, gate } from '@/lib/api-gate';
import { bookingJson } from '@/lib/bookings';
import { getDb } from '@/lib/db';
import { ensureHost } from '@/lib/hosts';
import { createInstantMeeting } from '@/lib/instant';
import type { EntryMode } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v0/instant-meetings, start an instant meeting
 * (Epic 8).
 *
 * The host picks an entry mode and optionally names the
 * meeting; everything else comes from the meeting settings
 * defaults (the participant limit, and the instant lifetime
 * that becomes the room window). The room is stamped and open
 * before the response returns, and the response is the usual
 * booking JSON, whose guestJoinUrl is the share link: one link,
 * many seats, each guest identified by their own guest key at
 * join time. No slot is claimed, no calendar event is written,
 * no guest is emailed.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const gated = await gate(request, { mutate: true });
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);

  let body: { title?: unknown; entryMode?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest('Request body must be JSON');
  }
  const entryMode: EntryMode = body.entryMode === 'waiting_room' ? 'waiting_room' : 'open';
  const title = typeof body.title === 'string' ? body.title : '';

  await getDb();
  const booking = await createInstantMeeting(host, { title, entryMode });
  return NextResponse.json({ booking: bookingJson(booking) }, { status: 201 });
}
