import { NextResponse } from 'next/server';

import { badRequest, gate, notFound } from '@/lib/api-gate';
import { bookingJson } from '@/lib/bookings';
import { getDb } from '@/lib/db';
import { ensureHost } from '@/lib/hosts';
import {
  ModerationError,
  admitGuest,
  denyGuest,
  endMeeting,
  muteAllGuests,
  muteParticipantMic,
  removeParticipantFromRoom,
} from '@/lib/moderation';
import { LiveKitNotConfiguredError, hostIdentityFor } from '@/lib/rooms';
import { MeetBooking } from '@/models/meet-booking';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

const ACTIONS = ['mute', 'mute_all', 'remove', 'end', 'admit', 'deny'] as const;
type ModerateAction = (typeof ACTIONS)[number];

/**
 * POST /api/v0/bookings/:id/moderate, the host's in-room
 * controls (Epic 4): mute one participant, mute all guests,
 * remove a participant, end the meeting, and the waiting
 * room decisions (admit, deny).
 *
 * Host only, enforced here the way every booking route
 * enforces it: the session gate, the caller's own host
 * record, and an owner-scoped booking lookup. A client flag
 * is never believed; a signed-in stranger gets the same 404
 * as a booking that does not exist.
 *
 * The effects are server side (lib/moderation.ts): LiveKit
 * server API calls and booking records, so a modified client
 * on the receiving end cannot ignore them.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gated = await gate(request, { mutate: true });
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  const { id } = await params;

  let body: { action?: unknown; identity?: unknown };
  try {
    body = (await request.json()) as { action?: unknown; identity?: unknown };
  } catch {
    return badRequest('Request body must be JSON');
  }
  const action = body.action as ModerateAction;
  if (!ACTIONS.includes(action)) {
    return badRequest('Unknown moderation action');
  }
  const identity =
    typeof body.identity === 'string' ? body.identity.trim().slice(0, 200) : '';

  await getDb();
  const booking = await MeetBooking.findOne({ _id: id, hostId: host._id });
  if (!booking) return notFound('No such booking');
  const type = await MeetType.findById(booking.meetTypeId);

  try {
    let mutedCount: number | undefined;
    switch (action) {
      case 'mute': {
        if (!identity) return badRequest('Mute needs a participant identity');
        await muteParticipantMic(booking, identity);
        break;
      }
      case 'mute_all': {
        mutedCount = await muteAllGuests(booking);
        break;
      }
      case 'remove': {
        if (!identity) return badRequest('Remove needs a participant identity');
        if (identity === hostIdentityFor(String(host._id))) {
          return badRequest('You cannot remove yourself from your own meeting');
        }
        await removeParticipantFromRoom(booking, identity);
        break;
      }
      case 'end': {
        await endMeeting(booking);
        break;
      }
      case 'admit': {
        await admitGuest(booking);
        break;
      }
      case 'deny': {
        await denyGuest(booking);
        break;
      }
    }
    return NextResponse.json({
      ok: true,
      action,
      ...(mutedCount !== undefined ? { mutedCount } : {}),
      booking: bookingJson(booking, type ?? undefined),
    });
  } catch (error) {
    if (error instanceof ModerationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }
    if (error instanceof LiveKitNotConfiguredError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 503 },
      );
    }
    throw error;
  }
}
