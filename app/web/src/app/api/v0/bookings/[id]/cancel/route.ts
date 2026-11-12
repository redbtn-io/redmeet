import { NextResponse } from 'next/server';

import { gate, notFound } from '@/lib/api-gate';
import { bookingJson, cancelBooking } from '@/lib/bookings';
import { getDb } from '@/lib/db';
import { ensureHost } from '@/lib/hosts';
import { MeetBooking } from '@/models/meet-booking';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v0/bookings/:id/cancel, the host cancels one of their
 * bookings. The calendar event is removed (the guest is notified by
 * Google) and the slot is freed. Owner-scoped: the booking must
 * belong to the caller's host record.
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
  const { calendarRemoved } = await cancelBooking(host, booking);
  const type = await MeetType.findById(booking.meetTypeId);
  return NextResponse.json({
    booking: bookingJson(booking, type ?? undefined),
    calendarRemoved,
  });
}
