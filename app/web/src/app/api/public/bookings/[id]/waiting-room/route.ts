import { NextResponse } from 'next/server';

import { notFound } from '@/lib/api-gate';
import { getDb } from '@/lib/db';
import { logJoinFailure } from '@/lib/join-events';
import { ModerationError, requestAdmission } from '@/lib/moderation';
import {
  RoomAccessError,
  RoomWindowError,
  instantGuestIdentityFor,
  isValidGuestKey,
} from '@/lib/rooms';
import { secretEquals } from '@/lib/session';
import { MeetBooking } from '@/models/meet-booking';

export const dynamic = 'force-dynamic';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

/**
 * POST /api/public/bookings/:id/waiting-room?t=<guest join
 * token>, the guest asks to be let in (Epic 4, feature 4.3).
 *
 * The credential is the same guest join token as the other
 * public room routes, checked the same way. Asking records
 * the wait on the booking; it mints NOTHING. The guest's
 * lobby polls join-info for the host's decision, and only an
 * 'admitted' state lets the room-token route mint. That is
 * what makes the waiting room honest: there is no publishing
 * token to steal or replay before admission.
 */
export async function POST(
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
    logJoinFailure('bad_token', { bookingId: id, role: 'guest', detail: 'waiting_room' });
    return NextResponse.json(
      { error: 'That join link is not valid', code: 'bad_token' },
      { status: 403 },
    );
  }

  let typedName = '';
  try {
    const body = (await request.json()) as { name?: unknown };
    if (typeof body?.name === 'string') typedName = body.name;
  } catch {
    // No body: the booked name is what the host sees.
  }

  // Instant meetings (Epic 8): the ask belongs to one guest,
  // identified by their guest key. Without a valid key there is
  // no guest to record the ask against, so the call is refused
  // the same way the mint refuses.
  let identity: string | undefined;
  if (booking.kind === 'instant') {
    const guestKey = search.get('g');
    if (!isValidGuestKey(guestKey)) {
      return NextResponse.json(
        { error: 'This invite link needs a guest key to join', code: 'guest_key_required' },
        { status: 400 },
      );
    }
    identity = instantGuestIdentityFor(id, guestKey);
  }

  try {
    await requestAdmission(booking, typedName || booking.guestName, new Date(), identity);
    const state =
      booking.kind === 'instant'
        ? ((booking.guestAdmissions ?? []).find((a) => a.identity === identity)?.state ?? 'none')
        : booking.guestAdmissionState;
    return NextResponse.json({ state });
  } catch (error) {
    if (error instanceof RoomWindowError) {
      logJoinFailure(error.code === 'room_not_open' ? 'room_not_open' : 'room_closed', {
        bookingId: id,
        role: 'guest',
        detail: 'waiting_room',
      });
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
    if (error instanceof RoomAccessError) {
      logJoinFailure('removed', { bookingId: id, role: 'guest', detail: 'waiting_room' });
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 403 },
      );
    }
    if (error instanceof ModerationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }
    throw error;
  }
}
