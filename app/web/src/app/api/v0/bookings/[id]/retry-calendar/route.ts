import { NextResponse } from 'next/server';

import { gate, notFound } from '@/lib/api-gate';
import { bookingJson, retryBookingCalendar } from '@/lib/bookings';
import { getDb } from '@/lib/db';
import { ensureHost } from '@/lib/hosts';
import { MeetBooking } from '@/models/meet-booking';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v0/bookings/:id/retry-calendar, the host retries the
 * calendar write for a booking whose invite did not land
 * (calendar_failed, or pending because the calendar was not
 * connected at booking time). The response carries the booking's
 * true status after the retry, confirmed only when the write
 * actually landed. Owner-scoped, like cancel.
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
  if (booking.status === 'confirmed' || booking.status === 'cancelled') {
    return NextResponse.json(
      { error: `That booking is already ${booking.status}`, code: 'not_retryable' },
      { status: 409 },
    );
  }
  await retryBookingCalendar(host, booking);
  const type = await MeetType.findById(booking.meetTypeId);
  return NextResponse.json({ booking: bookingJson(booking, type ?? undefined) });
}
