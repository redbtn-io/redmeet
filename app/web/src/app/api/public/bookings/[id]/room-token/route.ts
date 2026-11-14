import { NextResponse } from 'next/server';

import { notFound } from '@/lib/api-gate';
import { getDb } from '@/lib/db';
import { logJoinFailure } from '@/lib/join-events';
import {
  LiveKitNotConfiguredError,
  RoomAccessError,
  RoomFullError,
  RoomWindowError,
  ensureBookingRoom,
  mintRoomTokenForBooking,
} from '@/lib/rooms';
import { secretEquals } from '@/lib/session';
import { MeetBooking } from '@/models/meet-booking';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

/**
 * GET /api/public/bookings/:id/room-token?t=<guest join token>, the
 * GUEST path into the meeting room (Epic 1). Keep it thin: this is
 * the one place a person with no redbtn account touches the room
 * system, and the guest join token in their link is the whole of
 * their credential. It is checked in constant time against the
 * booking, and a token is minted only inside the room's open
 * window. The Hub token routes serve account holders; this route
 * exists because guests have no account, and it reuses the same
 * mint (lib/livekit.ts) so there is one token shape in the fleet.
 *
 * The join page that calls this is Epic 2. Errors are codes the
 * page can turn into plain words: bad_token, room_not_open,
 * room_closed, booking_cancelled, and (Epic 5) room_full. Every
 * refusal here and in the mint is logged in the Epic 5 failure
 * vocabulary, so a bad link (bad_token) reads differently in
 * the logs from a full room or a media problem.
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
    // The credential itself is never logged (the Epic 5 rule),
    // only the fact that it did not match.
    logJoinFailure('bad_token', { bookingId: id, role: 'guest' });
    return NextResponse.json(
      { error: 'That join link is not valid', code: 'bad_token' },
      { status: 403 },
    );
  }
  const type = await MeetType.findById(booking.meetTypeId);
  // The name the guest typed in the lobby (Epic 2, story 2.1.3)
  // is the name they appear under. It is theirs to set: the join
  // token already proved they hold the invite. The booked name
  // stays the fallback.
  const typedName = search.get('name')?.trim().slice(0, 120);

  try {
    await ensureBookingRoom(booking, type ?? undefined);
    const minted = await mintRoomTokenForBooking(booking, 'guest', {
      displayName: typedName || booking.guestName,
    });
    return NextResponse.json({
      token: minted.token,
      url: minted.url,
      room: minted.room,
      identity: minted.identity,
      displayName: minted.displayName,
      opensAt: minted.opensAt,
      closesAt: minted.closesAt,
    });
  } catch (error) {
    if (error instanceof RoomAccessError) {
      // Epic 4: removed by the host, or a waiting room the
      // host has not admitted them to. Both are 403: the
      // credential is fine, the access is not granted.
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 403 },
      );
    }
    if (error instanceof RoomWindowError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          opensAt: error.opensAt.toISOString(),
          closesAt: error.closesAt.toISOString(),
        },
        { status: error.code === 'room_not_open' ? 409 : 410 },
      );
    }
    if (error instanceof RoomFullError) {
      // Epic 5, story 5.1.3: the meeting is at its participant
      // limit. A 409 with its own code, so the lobby shows
      // "This meeting is full" instead of a generic failure.
      return NextResponse.json(
        { error: error.message, code: error.code, limit: error.limit },
        { status: 409 },
      );
    }
    if (error instanceof LiveKitNotConfiguredError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 503 },
      );
    }
    throw error;
  }
}
