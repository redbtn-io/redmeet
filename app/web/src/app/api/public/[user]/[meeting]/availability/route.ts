import { NextResponse } from 'next/server';

import { badRequest, notFound } from '@/lib/api-gate';
import { availabilityFor } from '@/lib/bookings';
import { getDb } from '@/lib/db';
import { getHostBySlug } from '@/lib/hosts';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/:user/:meeting/availability?date=YYYY-MM-DD
 * The bookable slots for one day, computed server-side from the host's
 * real calendar busy blocks plus this app's own bookings.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ user: string; meeting: string }> },
): Promise<NextResponse> {
  const { user, meeting } = await params;
  const date = new URL(request.url).searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest('Pass a date as YYYY-MM-DD');

  const host = await getHostBySlug(user);
  if (!host) return notFound('No booking page at that link');
  await getDb();
  const type = await MeetType.findOne({ hostId: host._id, slug: meeting, active: true });
  if (!type) return notFound('That meeting type is not bookable');

  const { slots, degraded } = await availabilityFor(host, type, date);
  return NextResponse.json({
    date,
    timeZone: host.timeZone,
    degraded,
    times: slots.map((s) => s.label),
  });
}
