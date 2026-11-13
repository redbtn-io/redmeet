import { NextResponse } from 'next/server';

import { gate, notFound } from '@/lib/api-gate';
import { getDb } from '@/lib/db';
import { ensureHost } from '@/lib/hosts';
import { roomPhase } from '@/lib/rooms';
import { MeetBooking } from '@/models/meet-booking';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v0/bookings/:id/waiting, the host's view of the
 * waiting room (Epic 4, feature 4.3). The in-room participant
 * list polls this: in a waiting room meeting it carries the
 * guest's admission state, so a waiting guest appears with
 * Admit and Deny the moment they ask. Owner scoped like
 * every booking route; a read, so the gate tolerates the
 * degraded session state.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gated = await gate(request);
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  const { id } = await params;
  await getDb();
  const booking = await MeetBooking.findOne({ _id: id, hostId: host._id });
  if (!booking) return notFound('No such booking');

  const state = booking.guestAdmissionState ?? 'none';
  return NextResponse.json({
    entryMode: booking.entryMode ?? 'open',
    phase: roomPhase(booking, new Date()),
    admission:
      state === 'none'
        ? null
        : {
            state,
            name: booking.guestAdmissionName || booking.guestName,
            requestedAt: booking.guestAdmissionRequestedAt
              ? booking.guestAdmissionRequestedAt.toISOString()
              : null,
            decidedAt: booking.guestAdmissionDecidedAt
              ? booking.guestAdmissionDecidedAt.toISOString()
              : null,
          },
  });
}
