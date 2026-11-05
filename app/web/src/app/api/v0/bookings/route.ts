import { NextResponse } from 'next/server';

import { gate } from '@/lib/api-gate';
import { bookingJson } from '@/lib/bookings';
import { getDb } from '@/lib/db';
import { ensureHost } from '@/lib/hosts';
import { MeetBooking } from '@/models/meet-booking';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v0/bookings, the caller's bookings (upcoming first, then
 * recent past), for the dashboard agenda.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const gated = await gate(request);
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  await getDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const bookings = await MeetBooking.find({ hostId: host._id, end: { $gte: since } })
    .sort({ start: 1 })
    .limit(100);
  const types = await MeetType.find({ hostId: host._id });
  const byId = new Map(types.map((t) => [String(t._id), t]));
  return NextResponse.json({
    bookings: bookings.map((b) => bookingJson(b, byId.get(String(b.meetTypeId)))),
  });
}
