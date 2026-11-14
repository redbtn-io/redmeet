import { NextResponse } from 'next/server';

import { notFound } from '@/lib/api-gate';
import { getDb } from '@/lib/db';
import { logJoinFailure } from '@/lib/join-events';
import { guestIdentityFor, roomClosesAt, roomOpensAt, roomPhase } from '@/lib/rooms';
import { secretEquals } from '@/lib/session';
import { MeetBooking } from '@/models/meet-booking';
import { MeetHost } from '@/models/meet-host';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

/**
 * GET /api/public/bookings/:id/join-info?t=<guest join token>, the
 * lobby's data (Epic 2). The join page renders meeting name, host,
 * and time, and needs to know where the room is in its lifecycle
 * BEFORE anyone tries to mint: too early is a lobby with a clock,
 * not an error, and a closed or cancelled meeting is a plain
 * message, not a failed join.
 *
 * The credential is the same guest join token as the room-token
 * route, checked the same way (constant time, against the
 * booking). Unlike the mint route, this one answers inside and
 * outside the window alike: the phase is data, not a refusal.
 * The only refusal is a bad token, which gets the same 403 the
 * mint route gives.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!OBJECT_ID_RE.test(id)) return notFound('No such booking');
  const presented = new URL(request.url).searchParams.get('t');
  await getDb();
  const booking = await MeetBooking.findById(id);
  if (!booking) return notFound('No such booking');
  if (!presented || !booking.guestJoinToken || !secretEquals(booking.guestJoinToken, presented)) {
    logJoinFailure('bad_token', { bookingId: id, role: 'guest', detail: 'join_info' });
    return NextResponse.json(
      { error: 'That join link is not valid', code: 'bad_token' },
      { status: 403 },
    );
  }
  const host = await MeetHost.findById(booking.hostId);
  const type = await MeetType.findById(booking.meetTypeId);
  if (!host || !type) return notFound('No such booking');

  const now = new Date();
  return NextResponse.json({
    meetingName: type.name,
    hostName: host.displayName,
    guestName: booking.guestName,
    start: booking.start.toISOString(),
    end: booking.end.toISOString(),
    phase: roomPhase(booking, now),
    opensAt: roomOpensAt(booking).toISOString(),
    closesAt: roomClosesAt(booking).toISOString(),
    status: booking.status,
    // Epic 4: the waiting room state the lobby polls while it
    // waits for the host's decision, and whether THIS guest
    // was removed (their identity is per booking, so the flag
    // is exact). Removed and ended are how a disconnected
    // guest's client tells what actually happened to them.
    entryMode: booking.entryMode ?? 'open',
    admissionState: booking.guestAdmissionState ?? 'none',
    removed: (booking.removedIdentities ?? []).includes(guestIdentityFor(id)),
  });
}
