import { NextResponse } from 'next/server';

import { notFound } from '@/lib/api-gate';
import { getDb } from '@/lib/db';
import {
  LiveKitNotConfiguredError,
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
 * room_closed, booking_cancelled.
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
    return NextResponse.json(
      { error: 'That join link is not valid', code: 'bad_token' },
      { status: 403 },
    );
  }
  const type = await MeetType.findById(booking.meetTypeId);

  try {
    await ensureBookingRoom(booking, type ?? undefined);
    const minted = await mintRoomTokenForBooking(booking, 'guest', {
      displayName: booking.guestName,
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
    if (error instanceof LiveKitNotConfiguredError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 503 },
      );
    }
    throw error;
  }
}
