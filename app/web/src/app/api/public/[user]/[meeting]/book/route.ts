import { NextResponse } from 'next/server';

import { bookingInputSchema, parseTimeLabel } from '@redmeet/core';

import { badRequest, notFound } from '@/lib/api-gate';
import { BookingConflictError, bookingJson, createBooking } from '@/lib/bookings';
import { getDb } from '@/lib/db';
import { getHostBySlug } from '@/lib/hosts';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/**
 * POST /api/public/:user/:meeting/book, a guest books a slot. No
 * session. The slot is recomputed server-side (see lib/bookings), the
 * booking recorded, and the calendar event written through the
 * gateway. The response reports the true status: `confirmed` only
 * when the calendar write landed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ user: string; meeting: string }> },
): Promise<NextResponse> {
  const { user, meeting } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body must be JSON');
  }
  const parsed = bookingInputSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? 'Check the form and try again');
  }
  if (parseTimeLabel(parsed.data.time) === null) {
    return badRequest('That time is not a bookable slot');
  }

  const host = await getHostBySlug(user);
  if (!host) return notFound('No booking page at that link');
  await getDb();
  const type = await MeetType.findOne({ hostId: host._id, slug: meeting, active: true });
  if (!type) return notFound('That meeting type is not bookable');

  try {
    const booking = await createBooking(host, type, parsed.data);
    return NextResponse.json({ booking: bookingJson(booking, type) }, { status: 201 });
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return NextResponse.json({ error: error.message, code: 'slot_unavailable' }, { status: 409 });
    }
    throw error;
  }
}
