import { NextResponse } from 'next/server';

import { gate, notFound } from '@/lib/api-gate';
import { getRecordingStorageConfig } from '@/lib/config';
import { getDb } from '@/lib/db';
import { ensureHost } from '@/lib/hosts';
import { refreshRecording, recordingStateFor } from '@/lib/recording';
import { getRecordingObject, headRecordingObject } from '@/lib/recording-storage';
import { MeetBooking } from '@/models/meet-booking';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v0/bookings/:id/recording, the finished recording
 * itself (Epic 6, story 6.2.1).
 *
 * The host plays and downloads the recording FROM THE
 * BOOKING, through this route, never by touching the server
 * and never through a storage URL: the bucket is private,
 * the object key never leaves the server, and this route is
 * the only door. Host gated and owner scoped like every
 * booking route (anonymous 401 from the gate, a signed-in
 * stranger 404). Guests get no recording access by default
 * (story 6.2.2): there is no public counterpart to this
 * route, and sharing a recording is a deliberate future
 * action, not a default this epic builds.
 *
 * Playback is range friendly: the Range header is forwarded
 * to S3, which answers 206 with Content-Range, so the
 * browser's video element can seek. `?download=1` flips the
 * disposition to an attachment with a friendly filename;
 * without it the file plays inline.
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

  // Settle from Egress's report first, so a recording that
  // finished since the last read is served, not 409ed.
  await refreshRecording(booking);
  if (booking.recordingStatus !== 'ready' || !booking.recordingKey) {
    return NextResponse.json(
      {
        error:
          booking.recordingStatus === 'failed'
            ? `This recording failed${booking.recordingError ? `: ${booking.recordingError}` : ''}`
            : 'This recording is not ready yet',
        code: 'recording_not_ready',
        recording: recordingStateFor(booking),
      },
      { status: 409 },
    );
  }
  const storage = getRecordingStorageConfig();
  if (!storage) {
    return NextResponse.json(
      { error: 'Recording storage is not set up on this deployment', code: 'recording_not_configured' },
      { status: 503 },
    );
  }

  const range = request.headers.get('range') ?? undefined;
  const download = new URL(request.url).searchParams.get('download') === '1';
  try {
    const object = await getRecordingObject(storage, booking.recordingKey, range);
    const partial = Boolean(range && object.contentRange);
    const headers = new Headers({
      'content-type': object.contentType,
      'accept-ranges': 'bytes',
      ...(object.contentLength !== undefined
        ? { 'content-length': String(object.contentLength) }
        : {}),
      ...(object.contentRange ? { 'content-range': object.contentRange } : {}),
      ...(object.etag ? { etag: object.etag } : {}),
      'content-disposition': download
        ? `attachment; filename="redmeet-recording-${id}.mp4"`
        : `inline; filename="redmeet-recording-${id}.mp4"`,
      'cache-control': 'private, no-store',
    });
    return new NextResponse(object.body, {
      status: partial ? 206 : 200,
      headers,
    });
  } catch (error) {
    // A ready booking whose object is missing is a broken
    // record, and the answer says so plainly instead of a 500.
    const head = await headRecordingObject(storage, booking.recordingKey).catch(() => null);
    if (!head || head.size === undefined) {
      return NextResponse.json(
        { error: 'The recording file could not be found in storage', code: 'recording_file_missing' },
        { status: 404 },
      );
    }
    throw error;
  }
}
