import { NextResponse } from 'next/server';

import { gate, notFound } from '@/lib/api-gate';
import { bookingJson } from '@/lib/bookings';
import { getDb } from '@/lib/db';
import { ensureHost } from '@/lib/hosts';
import { RoomExtendError, ensureBookingRoom, extendBookingRoom } from '@/lib/rooms';
import { MeetBooking } from '@/models/meet-booking';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v0/bookings/:id/extend-room, the host's one room
 * extension (Epic 1, story 1.3.4): pushes the room's close 30
 * minutes later, once. The in-room button that calls this is
 * Epic 3; the endpoint and the rule live here so the rule exists
 * in exactly one place. Owner scoped, like cancel.
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

  try {
    await ensureBookingRoom(booking, type ?? undefined);
    const closesAt = await extendBookingRoom(booking);
    return NextResponse.json({
      booking: bookingJson(booking, type ?? undefined),
      closesAt: closesAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof RoomExtendError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }
    throw error;
  }
}
