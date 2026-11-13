import { NextResponse } from 'next/server';

import { gate, notFound } from '@/lib/api-gate';
import { getDb } from '@/lib/db';
import { ensureHost } from '@/lib/hosts';
import {
  LiveKitNotConfiguredError,
  RoomWindowError,
  ensureBookingRoom,
  mintRoomTokenForBooking,
} from '@/lib/rooms';
import { MeetBooking } from '@/models/meet-booking';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v0/bookings/:id/room-token, the host's path into the
 * meeting room (Epic 1). The host is the signed-in caller, owner
 * scoped like every other booking route; the endpoint mints a fresh
 * host token for this booking's room, inside its open window only.
 *
 * The response shape mirrors the Hub's voice token route
 * (token, url, room, identity, displayName), plus the room window
 * so the client can say when the room opens or closed instead of
 * failing silently. The join UI that consumes this is Epic 2 and 3.
 *
 * Outside the window the answer is a 409 carrying the window, not
 * a token: opensAt in the future means come back then, a closesAt
 * in the past means the room is done.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gated = await gate(request, { mutate: true });
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  const { id } = await params;
  await getDb();
  const booking = await MeetBooking.findOne({ _id: id, hostId: host._id });
  if (!booking) return notFound('No such booking');
  const type = await MeetType.findById(booking.meetTypeId);
  // The name typed in the lobby (Epic 2) wins over the profile
  // display name; a host may want to appear as something more
  // specific for one meeting. The body is optional and untrusted
  // input, so it is shape-checked, never assumed.
  let typedName = '';
  try {
    const body = (await request.json()) as { displayName?: unknown };
    if (typeof body?.displayName === 'string') typedName = body.displayName.trim().slice(0, 120);
  } catch {
    // No body, or not JSON: the profile name is the fallback.
  }

  try {
    await ensureBookingRoom(booking, type ?? undefined);
    const minted = await mintRoomTokenForBooking(booking, 'host', {
      displayName: typedName || host.displayName,
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
