import { NextResponse } from 'next/server';

import { badRequest, gate, notFound } from '@/lib/api-gate';
import { bookingJson } from '@/lib/bookings';
import { getDb } from '@/lib/db';
import { ensureHost } from '@/lib/hosts';
import {
  RecordingError,
  RecordingNotConfiguredError,
  refreshRecording,
  recordingStateFor,
  startRecording,
  stopRecording,
} from '@/lib/recording';
import { LiveKitNotConfiguredError, LiveKitUnreachableError } from '@/lib/rooms';
import { MeetBooking } from '@/models/meet-booking';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/**
 * The host's record control (Epic 6, story 6.1.1).
 *
 * POST /api/v0/bookings/:id/record { action: 'start'|'stop' }
 * drives the recording on the booking, server side through
 * LiveKit Egress (lib/recording.ts). GET reads the state
 * back, settled from Egress's own report first, which is
 * what the dashboard polls while a recording is processing.
 *
 * Host only, enforced exactly the way the moderate route
 * enforces it: the session gate, the caller's own host
 * record, and an owner-scoped booking lookup, so a signed-in
 * stranger gets the same 404 as a booking that does not
 * exist, and an anonymous caller gets 401 from the gate.
 * Guests have no route to this at all: there is deliberately
 * no public counterpart.
 *
 * Every refusal is a clean code with plain words, in the
 * Epic 5 shape: capacity is a 409 that says the meeting
 * continues unrecorded, an unconfigured deployment is a 503
 * that says recording is not set up, and nothing surfaces a
 * raw Egress or SDK failure.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gated = await gate(request, { mutate: true });
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  const { id } = await params;

  let body: { action?: unknown };
  try {
    body = (await request.json()) as { action?: unknown };
  } catch {
    return badRequest('Request body must be JSON');
  }
  if (body.action !== 'start' && body.action !== 'stop') {
    return badRequest('Unknown recording action');
  }

  await getDb();
  const booking = await MeetBooking.findOne({ _id: id, hostId: host._id });
  if (!booking) return notFound('No such booking');
  const type = await MeetType.findById(booking.meetTypeId);

  try {
    if (body.action === 'start') {
      await startRecording(booking);
    } else {
      await stopRecording(booking);
    }
    return NextResponse.json({
      ok: true,
      action: body.action,
      recording: recordingStateFor(booking),
      booking: bookingJson(booking, type ?? undefined),
    });
  } catch (error) {
    if (error instanceof RecordingNotConfiguredError || error instanceof LiveKitNotConfiguredError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 503 },
      );
    }
    if (error instanceof RecordingError || error instanceof LiveKitUnreachableError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }
    throw error;
  }
}

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
  await refreshRecording(booking);
  return NextResponse.json({ recording: recordingStateFor(booking) });
}
