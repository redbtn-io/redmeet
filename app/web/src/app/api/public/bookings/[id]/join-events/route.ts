import { NextResponse } from 'next/server';

import { badRequest, notFound } from '@/lib/api-gate';
import { getDb } from '@/lib/db';
import {
  isJoinFailureType,
  logJoinFailure,
  logMeetingEvent,
} from '@/lib/join-events';
import { guestIdentityFor, hostIdentityFor } from '@/lib/rooms';
import { resolveSession, secretEquals } from '@/lib/session';
import { MeetBooking } from '@/models/meet-booking';
import { MeetHost } from '@/models/meet-host';

export const dynamic = 'force-dynamic';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

/**
 * POST /api/public/bookings/:id/join-events, the client's
 * half of join observability (Epic 5, stories 5.1.2 and
 * 5.1.4).
 *
 * The server sees mints and refusals, but two things only
 * the client knows: that a participant actually connected
 * and later left, and that the BROWSER blocked something
 * (camera or mic permission denied, no device, a media
 * failure before any server call could fail). This endpoint
 * accepts exactly those reports and nothing more:
 *
 *   { kind: 'joined' }    a participant connected
 *   { kind: 'left' }      a participant left on purpose
 *   { kind: 'failure', failureType: <the Epic 5 vocabulary> }
 *
 * The credential is the one the caller already holds: the
 * guest join token in the body for a guest (never in a URL
 * here, never logged), or the caller's own session for the
 * host who owns the booking. Both are validated against the
 * booking, the failure type is validated against the
 * vocabulary, and the answer is 204 either way: reporting
 * an event is fire and forget for the client, and a report
 * that fails validation is a 4xx, never a log line with
 * attacker-chosen fields in it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!OBJECT_ID_RE.test(id)) return notFound('No such booking');

  let body: { t?: unknown; kind?: unknown; failureType?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest('Request body must be JSON');
  }
  const kind = body.kind;
  if (kind !== 'joined' && kind !== 'left' && kind !== 'failure') {
    return badRequest('Unknown event kind');
  }
  if (kind === 'failure' && !isJoinFailureType(body.failureType)) {
    return badRequest('Unknown failure type');
  }

  await getDb();
  const booking = await MeetBooking.findById(id);
  if (!booking) return notFound('No such booking');

  let role: 'host' | 'guest' | null = null;
  if (
    typeof body.t === 'string' &&
    booking.guestJoinToken &&
    secretEquals(booking.guestJoinToken, body.t)
  ) {
    role = 'guest';
  } else {
    try {
      const session = await resolveSession(request);
      if (session.ok) {
        const ownHost = await MeetHost.findOne({ ownerId: session.user.userId });
        if (ownHost && String(ownHost._id) === String(booking.hostId)) role = 'host';
      }
    } catch {
      role = null;
    }
  }
  if (!role) {
    logJoinFailure('bad_token', { bookingId: id, detail: 'join_events' });
    return NextResponse.json(
      { error: 'That join link is not valid', code: 'bad_token' },
      { status: 403 },
    );
  }

  const identity =
    role === 'host' ? hostIdentityFor(String(booking.hostId)) : guestIdentityFor(id);
  const fields = { bookingId: id, room: booking.roomId, role, identity };
  if (kind === 'joined') {
    logMeetingEvent('participant_joined', fields);
  } else if (kind === 'left') {
    logMeetingEvent('participant_left', fields);
  } else if (kind === 'failure' && isJoinFailureType(body.failureType)) {
    logJoinFailure(body.failureType, { ...fields, detail: 'client_report' });
  }
  return new NextResponse(null, { status: 204 });
}
