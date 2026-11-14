import 'server-only';

import { EncodedFileOutput, EncodedFileType, EgressStatus, S3Upload } from 'livekit-server-sdk';

import type { HydratedDocument } from 'mongoose';

import { getLiveKitConfig, getRecordingStorageConfig } from '@/lib/config';
import { logMeetingEvent } from '@/lib/join-events';
import { egressService } from '@/lib/livekit';
import { logger } from '@/lib/log';
import { LiveKitNotConfiguredError, LiveKitUnreachableError } from '@/lib/rooms';
import type { MeetBookingDoc, RecordingStatus } from '@/models/meet-booking';

/**
 * Meeting recording (Epic 6): LiveKit Egress room composite
 * to the fleet's object storage, owned by the booking.
 *
 * How it fits the fleet, per redCast's Egress work and the
 * Become and hub storage pattern:
 *
 *   - One Egress service already runs on each media host
 *     (redServer, alphaWorker) against the same LiveKit
 *     cluster; there is no static storage config on the
 *     Egress service, outputs are named per request. redCast
 *     drives it with EgressClient from livekit-server-sdk
 *     for its fanout streams; this module drives the same
 *     client for room composite FILES.
 *   - The file destination is the fleet storage pattern:
 *     MinIO over its S3 API, a bucket per app, credentials
 *     per app in env (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID,
 *     S3_SECRET_ACCESS_KEY). Egress uploads the MP4 itself,
 *     with the credentials carried in the start request, and
 *     the playback route reads the same bucket with the same
 *     pair. Nothing here invents a new store.
 *
 * How completion is learned: POLLING, deliberately. The
 * LiveKit server's webhook list is deployment config shared
 * with other products (redCast above all), and pointing it at
 * redMeet would mean editing and restarting the fleet's media
 * server for one app. Egress answers status queries instead,
 * so the record route, the dashboard read, the room state
 * polls, and the reconciliation sweep all refresh from the
 * same listEgress call, and no shared config moves.
 *
 * The state model is the booking's (models/meet-booking.ts):
 * idle, recording, processing, ready, failed. A recording is
 * marked ready ONLY when Egress reports EGRESS_COMPLETE with
 * a file result; a failed, aborted, or vanished job is
 * failed with its reason, never ready.
 *
 * The deliberate exception to the settings rule, named: the
 * Egress lane ceiling below is NOT a meeting type setting.
 * It is a cluster capacity fact, four simultaneous lanes
 * across every tenant including redCast (the fleet's own
 * capacity policy, redcast/docs/fanout-egress-capacity.md),
 * and a per meeting number could only lie about capacity
 * redMeet does not own. It lives here, in one place, so the
 * day the fleet's policy changes the redMeet side is a one
 * line edit. The egress encoding itself (MP4, grid layout)
 * is likewise a server side media property, not a host
 * preference.
 */

/** Simultaneous Egress lanes, cluster wide, all tenants (see the header). */
export const EGRESS_LANE_LIMIT = 4;

export type RecordingErrorCode =
  | 'recording_not_configured'
  | 'already_recording'
  | 'not_recording'
  | 'egress_capacity'
  | 'recording_start_failed';

export class RecordingError extends Error {
  readonly code: RecordingErrorCode;
  constructor(code: RecordingErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class RecordingNotConfiguredError extends RecordingError {
  constructor() {
    super(
      'recording_not_configured',
      'Recording is not set up on this deployment yet, so this meeting cannot be recorded.',
    );
  }
}

/**
 * The recording failure vocabulary, in the Epic 5 style: a
 * small fixed set of types on a warning line shaped like the
 * join failure lines, so a capacity refusal can be told apart
 * from an Egress failure in the logs at a glance.
 *
 *   egress_capacity        every Egress lane was busy, nothing started
 *   egress_failed          Egress reported the job failed
 *   egress_aborted         Egress reported the job aborted
 *   egress_lost            the job vanished from Egress's own list
 *   livekit_unreachable    the media server could not be asked
 *   recording_not_configured  storage or LiveKit config missing
 */
export type RecordingFailureType =
  | 'egress_capacity'
  | 'egress_failed'
  | 'egress_aborted'
  | 'egress_lost'
  | 'livekit_unreachable'
  | 'recording_not_configured';

function logRecordingFailure(
  type: RecordingFailureType,
  booking: Pick<MeetBookingDoc, 'roomId'>,
  bookingId: string,
  detail?: string,
): void {
  logger.warn('recording failed', {
    event: 'recording_failed',
    type,
    bookingId,
    room: booking.roomId,
    ...(detail ? { detail } : {}),
  });
}

type Booking = HydratedDocument<MeetBookingDoc>;

function bookingIdOf(booking: Booking): string {
  return String(booking._id);
}

/** The object key a booking's recording is stored under. One booking, one file. */
export function recordingKeyFor(bookingId: string): string {
  return `recordings/${bookingId}.mp4`;
}

/** Statuses in which a recording occupies an Egress lane or is still settling. */
export function recordingIsActive(status: RecordingStatus | undefined): boolean {
  return status === 'recording' || status === 'processing';
}

/**
 * The public state shape the room polls and the dashboard
 * read. Carries no storage reference and no Egress id: guests
 * learn that recording is on (that is the consent surface),
 * never where the file lives.
 */
export interface RecordingState {
  status: RecordingStatus;
  active: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
  error: string | null;
}

export function recordingStateFor(
  booking: Pick<
    MeetBookingDoc,
    | 'recordingStatus'
    | 'recordingStartedAt'
    | 'recordingStoppedAt'
    | 'recordingDurationSeconds'
    | 'recordingSizeBytes'
    | 'recordingError'
  >,
): RecordingState {
  const status = booking.recordingStatus ?? 'idle';
  return {
    status,
    active: status === 'recording',
    startedAt: booking.recordingStartedAt ? booking.recordingStartedAt.toISOString() : null,
    stoppedAt: booking.recordingStoppedAt ? booking.recordingStoppedAt.toISOString() : null,
    durationSeconds: booking.recordingDurationSeconds ?? null,
    sizeBytes: booking.recordingSizeBytes ?? null,
    error: booking.recordingError ?? null,
  };
}

function egressClientOrThrow() {
  const config = getLiveKitConfig();
  if (!config) throw new LiveKitNotConfiguredError();
  return egressService(config);
}

/**
 * Count the Egress lanes in use across the WHOLE cluster,
 * every tenant, redCast included: the LiveKit server's own
 * active list is the one count that sees all of them. Jobs
 * starting, active, and ending all hold their lane until
 * they settle.
 */
export async function countActiveEgressLanes(): Promise<number> {
  const client = egressClientOrThrow();
  const active = await client.listEgress({ active: true });
  return active.filter(
    (info) =>
      info.status === EgressStatus.EGRESS_STARTING ||
      info.status === EgressStatus.EGRESS_ACTIVE ||
      info.status === EgressStatus.EGRESS_ENDING,
  ).length;
}

/**
 * Start recording this booking's room (story 6.1.1). Host
 * gating is the route's job; this owns the state machine and
 * the Egress call.
 *
 * Capacity (story 6.1.4): the lane count is checked BEFORE
 * starting, and Egress's own refusal is classified as
 * capacity too where it reads as one, so the host hears
 * "every recording lane is busy" in plain words and the
 * meeting continues unrecorded. Nothing here ever throws an
 * unclassified error at the record control.
 */
export async function startRecording(booking: Booking): Promise<void> {
  const bookingId = bookingIdOf(booking);
  if (!getLiveKitConfig()) {
    logRecordingFailure('recording_not_configured', booking, bookingId, 'livekit');
    throw new RecordingNotConfiguredError();
  }
  const storage = getRecordingStorageConfig();
  if (!storage) {
    logRecordingFailure('recording_not_configured', booking, bookingId, 'storage');
    throw new RecordingNotConfiguredError();
  }
  if (!booking.roomId) {
    throw new RecordingError('recording_start_failed', 'This meeting has no room to record yet.');
  }
  if (booking.recordingStatus === 'recording' || booking.recordingStatus === 'processing') {
    throw new RecordingError('already_recording', 'This meeting is already being recorded.');
  }

  const client = egressClientOrThrow();
  let lanes: number;
  try {
    lanes = await countActiveEgressLanes();
  } catch (error) {
    logger.warn('egress lane count failed at recording start', {
      bookingId,
      error: String(error),
    });
    logRecordingFailure('livekit_unreachable', booking, bookingId);
    throw new LiveKitUnreachableError();
  }
  if (lanes >= EGRESS_LANE_LIMIT) {
    logRecordingFailure('egress_capacity', booking, bookingId, `lanes_${lanes}`);
    throw new RecordingError(
      'egress_capacity',
      'Recording could not start: every recording lane is busy right now. The meeting continues unrecorded; you can try again in a bit.',
    );
  }

  const keyMaterial = storage.secretAccessKey;
  const key = recordingKeyFor(bookingId);
  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: key,
    disableManifest: true,
    output: {
      case: 's3',
      value: new S3Upload({
        accessKey: storage.accessKeyId,
        secret: keyMaterial,
        bucket: storage.bucket,
        endpoint: storage.endpoint,
        region: storage.region,
        forcePathStyle: storage.forcePathStyle,
      }),
    },
  });

  let info;
  try {
    info = await client.startRoomCompositeEgress(booking.roomId, output, {
      layout: 'grid',
    });
  } catch (error) {
    const text = String(error).toLowerCase();
    if (
      text.includes('resource_exhausted') ||
      text.includes('no egress') ||
      text.includes('limit') ||
      text.includes('capacity')
    ) {
      logRecordingFailure('egress_capacity', booking, bookingId, 'egress_refused');
      throw new RecordingError(
        'egress_capacity',
        'Recording could not start: every recording lane is busy right now. The meeting continues unrecorded; you can try again in a bit.',
      );
    }
    logger.warn('egress start failed', { bookingId, room: booking.roomId, error: String(error) });
    logRecordingFailure('livekit_unreachable', booking, bookingId, 'start_failed');
    throw new LiveKitUnreachableError();
  }
  if (info.status === EgressStatus.EGRESS_FAILED || info.status === EgressStatus.EGRESS_ABORTED) {
    const reason = info.error || 'The recording service refused the job.';
    logRecordingFailure(
      info.status === EgressStatus.EGRESS_ABORTED ? 'egress_aborted' : 'egress_failed',
      booking,
      bookingId,
      'start_rejected',
    );
    throw new RecordingError('recording_start_failed', `Recording could not start: ${reason}`);
  }

  booking.recordingStatus = 'recording';
  booking.recordingEgressId = info.egressId;
  booking.recordingStartedAt = new Date();
  booking.recordingStoppedAt = undefined;
  booking.recordingKey = key;
  booking.recordingDurationSeconds = undefined;
  booking.recordingSizeBytes = undefined;
  booking.recordingError = undefined;
  await booking.save();
  logMeetingEvent('recording', {
    bookingId,
    room: booking.roomId,
    action: 'started',
    detail: info.egressId,
  });
}

/**
 * Stop the live recording (story 6.1.1). The booking moves to
 * `processing`: Egress is still finishing the file and
 * uploading it, and refreshRecording settles it from there.
 */
export async function stopRecording(booking: Booking): Promise<void> {
  const bookingId = bookingIdOf(booking);
  if (booking.recordingStatus === 'processing') return; // Stop already asked.
  if (booking.recordingStatus !== 'recording' || !booking.recordingEgressId) {
    throw new RecordingError('not_recording', 'This meeting is not being recorded.');
  }
  const client = egressClientOrThrow();
  try {
    await client.stopEgress(booking.recordingEgressId);
  } catch (error) {
    logger.warn('egress stop failed', {
      bookingId,
      room: booking.roomId,
      error: String(error),
    });
    logRecordingFailure('livekit_unreachable', booking, bookingId, 'stop_failed');
    throw new LiveKitUnreachableError();
  }
  booking.recordingStatus = 'processing';
  booking.recordingStoppedAt = new Date();
  await booking.save();
  logMeetingEvent('recording', {
    bookingId,
    room: booking.roomId,
    action: 'stopped',
    detail: booking.recordingEgressId,
  });
}

/**
 * Settle a recording from Egress's own report (story 6.1.3).
 * Called by the record route, the recording file route, the
 * bookings read, and the reconciliation sweep, so a finished
 * file lands on the booking whichever surface the host
 * touches first, with the duration and size from Egress's
 * file result. A job Egress no longer knows about is failed
 * as lost, never left hanging and never marked ready.
 */
export async function refreshRecording(booking: Booking): Promise<void> {
  if (!recordingIsActive(booking.recordingStatus) || !booking.recordingEgressId) return;
  const bookingId = bookingIdOf(booking);
  const client = egressClientOrThrow();
  let infos;
  try {
    infos = await client.listEgress({ egressId: booking.recordingEgressId });
  } catch (error) {
    // A failed status read settles nothing; the next refresh retries.
    logger.warn('egress status read failed', { bookingId, error: String(error) });
    return;
  }
  const info = infos[0];
  if (!info) {
    booking.recordingStatus = 'failed';
    booking.recordingError = 'The recording job was lost before it finished.';
    await booking.save();
    logRecordingFailure('egress_lost', booking, bookingId);
    return;
  }
  switch (info.status) {
    case EgressStatus.EGRESS_STARTING:
    case EgressStatus.EGRESS_ACTIVE:
      if (booking.recordingStatus !== 'recording') {
        booking.recordingStatus = 'recording';
        await booking.save();
      }
      return;
    case EgressStatus.EGRESS_ENDING:
      if (booking.recordingStatus !== 'processing') {
        booking.recordingStatus = 'processing';
        booking.recordingStoppedAt = booking.recordingStoppedAt ?? new Date();
        await booking.save();
      }
      return;
    case EgressStatus.EGRESS_COMPLETE: {
      const file = info.fileResults[0];
      if (!file) {
        booking.recordingStatus = 'failed';
        booking.recordingError = 'The recording finished without producing a file.';
        await booking.save();
        logRecordingFailure('egress_failed', booking, bookingId, 'no_file_result');
        return;
      }
      booking.recordingStatus = 'ready';
      booking.recordingStoppedAt = booking.recordingStoppedAt ?? new Date();
      // FileInfo.duration is nanoseconds; FileInfo.size is bytes.
      booking.recordingDurationSeconds = Math.round(Number(file.duration) / 1e9);
      booking.recordingSizeBytes = Number(file.size);
      booking.recordingError = undefined;
      await booking.save();
      logMeetingEvent('recording', {
        bookingId,
        room: booking.roomId,
        action: 'ready',
        detail: `seconds_${booking.recordingDurationSeconds}_bytes_${booking.recordingSizeBytes}`,
      });
      return;
    }
    case EgressStatus.EGRESS_FAILED:
    case EgressStatus.EGRESS_ABORTED:
    case EgressStatus.EGRESS_LIMIT_REACHED: {
      const aborted = info.status === EgressStatus.EGRESS_ABORTED;
      booking.recordingStatus = 'failed';
      booking.recordingError =
        info.error ||
        (info.status === EgressStatus.EGRESS_LIMIT_REACHED
          ? 'The recording hit a service limit and stopped.'
          : aborted
            ? 'The recording was aborted before it finished.'
            : 'The recording failed before it finished.');
      await booking.save();
      logRecordingFailure(
        aborted ? 'egress_aborted' : 'egress_failed',
        booking,
        bookingId,
        info.status === EgressStatus.EGRESS_LIMIT_REACHED ? 'limit_reached' : undefined,
      );
      return;
    }
    default:
      return;
  }
}

/**
 * Stop a live recording because the meeting itself is over
 * (host end, booking cancel). Best effort by design: the end
 * and the cancel must never fail because recording did, so a
 * stop failure is logged and the recording is left for the
 * sweep to settle from Egress's report.
 */
export async function stopRecordingIfActive(booking: Booking, reason: string): Promise<void> {
  if (booking.recordingStatus !== 'recording' || !booking.recordingEgressId) return;
  const bookingId = bookingIdOf(booking);
  try {
    const client = egressClientOrThrow();
    await client.stopEgress(booking.recordingEgressId);
    booking.recordingStatus = 'processing';
    booking.recordingStoppedAt = new Date();
    await booking.save();
    logMeetingEvent('recording', {
      bookingId,
      room: booking.roomId,
      action: 'stopped',
      detail: reason,
    });
  } catch (error) {
    logger.warn('recording stop on meeting end failed; the sweep will settle it', {
      bookingId,
      room: booking.roomId,
      error: String(error),
    });
  }
}
