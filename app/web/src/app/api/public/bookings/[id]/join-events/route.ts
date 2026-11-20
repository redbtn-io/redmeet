import { NextResponse } from 'next/server';

import { badRequest, notFound } from '@/lib/api-gate';
import { getDb } from '@/lib/db';
import {
  isJoinFailureType,
  logJoinFailure,
  logMeetingEvent,
} from '@/lib/join-events';
import {
  guestIdentityFor,
  hostIdentityFor,
  instantGuestIdentityFor,
  isValidGuestKey,
} from '@/lib/rooms';
import { resolveSession, secretEquals } from '@/lib/session';
import { MeetBooking } from '@/models/meet-booking';
import { MeetHost } from '@/models/meet-host';

export const dynamic = 'force-dynamic';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const DEVICE_DETAIL_RE = /^(mic|camera):[A-Za-z][A-Za-z0-9]*$/;
const ERROR_NAME_DETAIL_RE = /^[A-Za-z][A-Za-z0-9]*$/;

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
 * Two failure types carry a detail, and only in shapes this
 * endpoint dictates (Nov 20, 2026): device_enable_failed
 * sends mic:<ErrorName> or camera:<ErrorName>, and
 * post_connect_failed sends a bare <ErrorName>. A detail in
 * exactly one of those shapes is logged as the line's
 * detail; anything else falls back to the plain
 * client_report marker, so a client can never put prose of
 * its choosing into a log line through this field.
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

  let body: {
    t?: unknown;
    kind?: unknown;
    failureType?: unknown;
    g?: unknown;
    detail?: unknown;
  };
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

  // Instant meetings (Epic 8): the guest's own identity comes
  // from their guest key, so their joined and left lines name
  // the guest who actually came and went.
  const identity =
    role === 'host'
      ? hostIdentityFor(String(booking.hostId))
      : booking.kind === 'instant' && isValidGuestKey(body.g)
        ? instantGuestIdentityFor(id, body.g)
        : guestIdentityFor(id);
  const fields = { bookingId: id, room: booking.roomId, role, identity };
  if (kind === 'joined') {
    logMeetingEvent('participant_joined', fields);
  } else if (kind === 'left') {
    logMeetingEvent('participant_left', fields);
  } else if (kind === 'failure' && isJoinFailureType(body.failureType)) {
    // The detail is client-supplied only in the two dictated
    // shapes; anything else is the plain marker, never the
    // client's string.
    let detail = 'client_report';
    if (
      body.failureType === 'device_enable_failed' &&
      typeof body.detail === 'string' &&
      DEVICE_DETAIL_RE.test(body.detail)
    ) {
      detail = body.detail;
    } else if (
      body.failureType === 'post_connect_failed' &&
      typeof body.detail === 'string' &&
      ERROR_NAME_DETAIL_RE.test(body.detail)
    ) {
      detail = body.detail;
    }
    logJoinFailure(body.failureType, { ...fields, detail });
  }
  return new NextResponse(null, { status: 204 });
}
