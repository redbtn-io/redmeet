import { NextResponse } from 'next/server';

import { notFound } from '@/lib/api-gate';
import { getDb } from '@/lib/db';
import { logJoinFailure } from '@/lib/join-events';
import { recordingStateFor } from '@/lib/recording';
import {
  guestIdentityFor,
  instantGuestIdentityFor,
  isValidGuestKey,
  roomClosesAt,
  roomOpensAt,
  roomPhase,
} from '@/lib/rooms';
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
  const search = new URL(request.url).searchParams;
  const presented = search.get('t');
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
  const type = booking.meetTypeId ? await MeetType.findById(booking.meetTypeId) : null;
  // A booked meeting without its type is a broken record. An
  // instant meeting (Epic 8) has no type by design; its name
  // is the title on the record.
  if (!host || (!type && booking.kind !== 'instant')) return notFound('No such booking');

  // Epic 8: on an instant meeting the caller is one guest among
  // many, identified by their guest key. Their admission state
  // and removal flag are read from their own entry, so one
  // guest's state never leaks into another's answer. Without a
  // valid key the answer is the anonymous default (nothing
  // admitted, nothing removed), and the mint still refuses.
  const isInstant = booking.kind === 'instant';
  const guestKey = search.get('g');
  const identity =
    isInstant && isValidGuestKey(guestKey)
      ? instantGuestIdentityFor(id, guestKey)
      : guestIdentityFor(id);
  const admissionState = isInstant
    ? ((booking.guestAdmissions ?? []).find((a) => a.identity === identity)?.state ?? 'none')
    : (booking.guestAdmissionState ?? 'none');

  const now = new Date();
  return NextResponse.json({
    kind: booking.kind ?? 'booked',
    meetingName: type?.name ?? (booking.title || 'Instant meeting'),
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
    admissionState,
    removed: (booking.removedIdentities ?? []).includes(identity),
    // Epic 6: the recording state the in-room guest UI polls,
    // so the recording indicator and the start announcement
    // are driven by server state for everyone in the room,
    // late joiners included. This is the consent surface, so
    // it carries the state and nothing else: no object key,
    // no Egress id, no file access of any kind (story 6.2.2).
    recording: recordingStateFor(booking),
    // Epic 9: whether this meeting records automatically.
    // The lobby shows it before the guest joins, so the
    // notice lands before the recording does. A plain fact
    // about the meeting, nothing about the machinery.
    willRecord: booking.recordAutomatically === true,
  });
}
