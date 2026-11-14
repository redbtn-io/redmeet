import 'server-only';

import { randomUUID } from 'node:crypto';

import type { HydratedDocument } from 'mongoose';

import { getConfig, getLiveKitConfig } from '@/lib/config';
import { logJoinFailure, logMeetingEvent } from '@/lib/join-events';
import { mintRoomToken, roomService, type MintedRoomToken, type RoomRole } from '@/lib/livekit';
import { logger } from '@/lib/log';
import {
  MEETING_SETTING_DEFAULTS,
  resolveMeetingSettings,
} from '@/lib/meeting-settings';
import type { MeetBookingDoc } from '@/models/meet-booking';
import type { MeetTypeDoc } from '@/models/meet-type';

/**
 * Meeting rooms (Epic 1): one room per booking, owned by the
 * booking record.
 *
 * Lifecycle, per spec decision 9 and stories 1.3.1 to 1.3.4:
 *
 *   - The room is created AT BOOKING TIME. The room fields are
 *     stamped on the booking when it is claimed and the LiveKit
 *     room is created with the server API, so the join link
 *     (roomUrl) is stable from the moment the booking exists and
 *     the calendar event can carry it later (Epic 2). Creating the
 *     LiveKit room is best effort: LiveKit also creates rooms
 *     implicitly at first join, so a failed pre-create never sinks
 *     a booking.
 *   - The room OPENS a few minutes before the booking starts and
 *     CLOSES at roomExpiresAt, initially the booking end plus a
 *     close lag. Both numbers are meeting type settings since
 *     Epic 5 (defaults 5 and 15 minutes, resolved through
 *     lib/meeting-settings.ts and copied onto the booking), and
 *     both are enforced here, at mint time: no token is minted
 *     outside the window, and LiveKit itself needs no schedule.
 *   - An empty room stays open until expiry, so a dropped guest
 *     rejoins with the same link. Nothing closes a room early
 *     except host end (Epic 4) or cancellation.
 *   - The host can EXTEND the room, pushing roomExpiresAt later
 *     by the booking's extension minutes, up to the booking's
 *     extension count (defaults 30 minutes, once). The endpoint
 *     lives in this epic; the in-room button is Epic 3.
 *   - The room's participant limit is a meeting type setting
 *     too (Epic 5, default 10). It is set on the LiveKit room
 *     at pre-create AND enforced as product behavior at mint
 *     time (story 5.1.3): the joiner past the limit gets a
 *     room_full refusal, distinct from every other failure.
 *   - Token TTL follows the Hub voice shape (1 hour) but is capped
 *     so a token never outlives its room by more than a short
 *     grace: a participant mid-call at close time is not cut off
 *     by token expiry, and nobody can sit on a token and rejoin a
 *     closed room with it (the mint gate is the window; the TTL
 *     cap keeps stale tokens from lingering past it). The TTL is
 *     a server side security property on purpose (Epic 5): it
 *     is the one number in this file that is NOT a setting.
 */

/** Default open lead, kept for readers of the old constant: the setting in lib/meeting-settings.ts is the source now. */
export const ROOM_OPEN_LEAD_MS = MEETING_SETTING_DEFAULTS.openLeadMinutes * 60 * 1000;
/** Default close lag, kept for readers of the old constant: the setting in lib/meeting-settings.ts is the source now. */
export const ROOM_CLOSE_LAG_MS = MEETING_SETTING_DEFAULTS.closeLagMinutes * 60 * 1000;
/** Default extension size, kept for readers of the old constant: the setting in lib/meeting-settings.ts is the source now. */
export const ROOM_EXTEND_MS = MEETING_SETTING_DEFAULTS.extensionMinutes * 60 * 1000;
/** Default participant limit, kept for readers of the old constant: the setting in lib/meeting-settings.ts is the source now. */
export const ROOM_MAX_PARTICIPANTS = MEETING_SETTING_DEFAULTS.participantLimit;

const TOKEN_MAX_TTL_SECONDS = 60 * 60; // the Hub voice token shape: 1 hour
const TOKEN_CLOSE_GRACE_MS = 30 * 60 * 1000;
const TOKEN_MIN_TTL_SECONDS = 60;

export class LiveKitNotConfiguredError extends Error {
  readonly code = 'livekit_not_configured';
  constructor() {
    super('Video rooms are not configured on this deployment');
  }
}

/**
 * The media server could not be reached when the code needed
 * an answer from it (Epic 5). Surfaces to callers as a clean,
 * friendly code instead of whatever the SDK threw, so a route
 * can answer 503 (mint) or 409 (moderation) with words a
 * person can act on.
 */
export class LiveKitUnreachableError extends Error {
  readonly code = 'livekit_unreachable';
  constructor() {
    super('The video service cannot be reached right now. Try again in a moment.');
  }
}

export type RoomWindowCode = 'room_not_open' | 'room_closed' | 'booking_cancelled';

export class RoomWindowError extends Error {
  readonly code: RoomWindowCode;
  readonly opensAt: Date;
  readonly closesAt: Date;
  constructor(code: RoomWindowCode, opensAt: Date, closesAt: Date) {
    super(
      code === 'room_not_open'
        ? 'This room has not opened yet'
        : code === 'room_closed'
          ? 'This room has closed'
          : 'This booking was cancelled',
    );
    this.code = code;
    this.opensAt = opensAt;
    this.closesAt = closesAt;
  }
}

/**
 * The room is at its participant limit (Epic 5, story 5.1.3).
 * Distinct from the window and access errors because the next
 * step is different: wait for a seat, or ask the host.
 */
export class RoomFullError extends Error {
  readonly code = 'room_full';
  readonly limit: number;
  constructor(limit: number) {
    super('This meeting is full');
    this.limit = limit;
  }
}

/** The LiveKit identity of this booking's host participant. */
export function hostIdentityFor(hostId: string): string {
  return `host-${hostId}`;
}

/** The LiveKit identity of this booking's guest participant. */
export function guestIdentityFor(bookingId: string): string {
  return `guest-${bookingId}`;
}

export type RoomAccessCode = 'guest_removed' | 'admission_required';

/**
 * A guest who may not have a token even inside the room window
 * (Epic 4): they were removed by the host, or the meeting uses
 * a waiting room and the host has not admitted them yet. Kept
 * apart from RoomWindowError because these are not about time:
 * no amount of waiting inside the window fixes them, only the
 * host (admission) or nobody (removal) can.
 */
export class RoomAccessError extends Error {
  readonly code: RoomAccessCode;
  constructor(code: RoomAccessCode) {
    super(
      code === 'guest_removed'
        ? 'You were removed from this meeting'
        : 'The host has not let you in yet',
    );
    this.code = code;
  }
}

export class RoomExtendError extends Error {
  readonly code: 'already_extended' | 'booking_cancelled' | 'room_closed';
  constructor(code: RoomExtendError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** When this booking's room opens: its start minus its open lead setting (default 5 minutes). */
export function roomOpensAt(
  booking: Pick<MeetBookingDoc, 'start' | 'openLeadMinutes'>,
): Date {
  const { openLeadMinutes } = resolveMeetingSettings(booking);
  return new Date(booking.start.getTime() - openLeadMinutes * 60 * 1000);
}

/** The expiry a room gets at booking time: end plus its close lag setting (default 15 minutes). */
export function initialRoomExpiresAt(
  booking: Pick<MeetBookingDoc, 'end' | 'closeLagMinutes'>,
): Date {
  const { closeLagMinutes } = resolveMeetingSettings(booking);
  return new Date(booking.end.getTime() + closeLagMinutes * 60 * 1000);
}

/** The current expiry, falling back to the initial one for bookings stamped before it was stored. */
export function roomClosesAt(
  booking: Pick<MeetBookingDoc, 'end' | 'roomExpiresAt' | 'closeLagMinutes'>,
): Date {
  return booking.roomExpiresAt ?? initialRoomExpiresAt(booking);
}

export type RoomPhase = 'not_open' | 'open' | 'closed' | 'cancelled';

/** Where the room is in its lifecycle at `now`. Pure, so it is testable without a database. */
export function roomPhase(
  booking: Pick<
    MeetBookingDoc,
    'start' | 'end' | 'status' | 'roomStatus' | 'roomExpiresAt' | 'openLeadMinutes' | 'closeLagMinutes'
  >,
  now: Date,
): RoomPhase {
  if (booking.status === 'cancelled') return 'cancelled';
  if (booking.roomStatus === 'closed') return 'closed';
  if (now.getTime() > roomClosesAt(booking).getTime()) return 'closed';
  if (now.getTime() < roomOpensAt(booking).getTime()) return 'not_open';
  return 'open';
}

/** The room name for a booking. Unique per booking, stable for its life. */
export function roomNameFor(bookingId: string): string {
  return `redmeet-${bookingId}`;
}

/** The guest-facing join URL for a booking's room. */
export function roomUrlFor(bookingId: string): string {
  const base = getConfig().baseUrl || 'https://meet.redbtn.io';
  return `${base.replace(/\/+$/, '')}/join/${bookingId}`;
}

/**
 * The guest's full join LINK (Epic 2): the room URL carrying the
 * guest join token, the one credential a guest has. This is what
 * goes in the calendar event and on the confirmation page. Null
 * when the booking has no room stamped yet (the caller stamps
 * lazily, or falls back honestly when it cannot). The HOST join
 * token never appears in any link: the host's path is their
 * session, and this helper only ever reads `guestJoinToken`.
 */
export function guestJoinUrlFor(
  booking: Pick<MeetBookingDoc, 'roomUrl' | 'guestJoinToken'>,
): string | null {
  if (!booking.roomUrl || !booking.guestJoinToken) return null;
  return `${booking.roomUrl}?t=${encodeURIComponent(booking.guestJoinToken)}`;
}

/**
 * Stamp the room fields on a booking that does not have them yet
 * and create the LiveKit room. Idempotent: a booking that already
 * carries a roomId is returned untouched, so the token endpoints
 * can call this lazily for bookings made before rooms existed.
 *
 * The save is the caller's contract: if stamping fails, the booking
 * flow must not fail with it (createBooking catches), because a
 * booking without video is still a booking, while the reverse is
 * not true.
 */
export async function ensureBookingRoom(
  booking: HydratedDocument<MeetBookingDoc>,
  type?: MeetTypeDoc,
): Promise<void> {
  if (booking.roomId) return;
  const bookingId = String(booking._id);
  // The entry mode is carried from the meeting type at stamp
  // time (Epic 4, feature 4.3), the same moment the room fields
  // land, so a booking keeps the mode its type had when it was
  // booked even if the host changes the type later.
  booking.entryMode = type?.entryMode ?? booking.entryMode ?? 'open';
  // The behavior settings ride along at the same moment (Epic
  // 5): resolved from the type when there is one, from the
  // booking itself when there is not, defaults filling every
  // gap, and stamped only where the booking does not already
  // carry a value.
  const settings = resolveMeetingSettings(type ?? booking);
  if (booking.participantLimit === undefined) booking.participantLimit = settings.participantLimit;
  if (booking.openLeadMinutes === undefined) booking.openLeadMinutes = settings.openLeadMinutes;
  if (booking.closeLagMinutes === undefined) booking.closeLagMinutes = settings.closeLagMinutes;
  if (booking.extensionMinutes === undefined) booking.extensionMinutes = settings.extensionMinutes;
  if (booking.extensionsAllowed === undefined) booking.extensionsAllowed = settings.extensionsAllowed;
  booking.roomId = roomNameFor(bookingId);
  booking.roomUrl = roomUrlFor(bookingId);
  booking.guestJoinToken = randomUUID();
  booking.hostJoinToken = randomUUID();
  booking.roomProvider = type?.roomProvider || 'livekit';
  booking.roomStatus = 'not_created';
  booking.roomCreatedAt = new Date();
  booking.roomExpiresAt = initialRoomExpiresAt(booking);
  booking.roomExtended = false;
  await booking.save();
  const created = await createLiveKitRoom(booking);
  if (created) {
    logMeetingEvent('room_created', { bookingId, room: booking.roomId });
  }
}

/**
 * Create the room on the LiveKit server, best effort. The room is
 * created with an empty timeout that reaches just past expiry, so
 * LiveKit itself drops an empty room once it has closed; a room
 * with participants in it is never dropped by that timer. The
 * participant cap on the server room is the booking's own limit
 * setting (Epic 5), the same number the mint enforces.
 */
export async function createLiveKitRoom(
  booking: Pick<
    MeetBookingDoc,
    'roomId' | 'end' | 'roomExpiresAt' | 'participantLimit' | 'closeLagMinutes'
  >,
): Promise<boolean> {
  const config = getLiveKitConfig();
  if (!config || !booking.roomId) return false;
  try {
    const emptyTimeout = Math.max(
      300,
      Math.ceil((roomClosesAt(booking).getTime() - Date.now()) / 1000) + 300,
    );
    await roomService(config).createRoom({
      name: booking.roomId,
      emptyTimeout,
      maxParticipants: resolveMeetingSettings(booking).participantLimit,
    });
    return true;
  } catch (error) {
    // A room that already exists (a retried stamp) is success, not failure.
    if (String(error).includes('already exists')) return true;
    logger.warn('LiveKit room pre-create failed; the room will be created at first join', {
      roomId: booking.roomId,
      error: String(error),
    });
    return false;
  }
}

/** Delete the room on the LiveKit server, best effort. Used when a booking is cancelled. */
export async function deleteLiveKitRoom(roomId: string | undefined): Promise<void> {
  const config = getLiveKitConfig();
  if (!config || !roomId) return;
  try {
    await roomService(config).deleteRoom(roomId);
  } catch (error) {
    logger.warn('LiveKit room delete failed; the room expires on its own schedule', {
      roomId,
      error: String(error),
    });
  }
}

export interface RoomTokenResult extends MintedRoomToken {
  url: string;
  opensAt: string;
  closesAt: string;
}

/**
 * Pure form of the full room decision (story 5.1.3): the room
 * is full for this identity when the seat count has reached
 * the limit and the identity is not already holding one of
 * those seats. A participant who dropped and rejoins with the
 * same link keeps their seat; the guest link is one seat by
 * design (Epic 2), and the host is one seat.
 */
export function isRoomFullFor(
  participantIdentities: string[],
  identity: string,
  limit: number,
): boolean {
  if (participantIdentities.includes(identity)) return false;
  return participantIdentities.length >= limit;
}

function isRoomNotFoundError(error: unknown): boolean {
  const text = String(error).toLowerCase();
  return text.includes('not found') || text.includes('does not exist');
}

/**
 * Mint a token for this booking's room, enforcing the lifecycle
 * window. This is the ONLY path that mints meeting tokens, so the
 * window cannot be bypassed by a route forgetting to check it.
 *
 * Every refusal and every success is logged in the Epic 5 shape
 * (lib/join-events.ts): the failure vocabulary on refusals, a
 * token_minted event on success. The token VALUE is never
 * logged, here or anywhere.
 *
 * `displayName` is the name the participant appears under: the
 * host's display name for a host token, the booked guest's name
 * for a guest token.
 */
export async function mintRoomTokenForBooking(
  booking: HydratedDocument<MeetBookingDoc>,
  role: RoomRole,
  opts: { displayName: string; now?: Date },
): Promise<RoomTokenResult> {
  const bookingId = String(booking._id);
  const config = getLiveKitConfig();
  if (!config) {
    logJoinFailure('livekit_unreachable', {
      bookingId,
      role,
      detail: 'not_configured',
    });
    throw new LiveKitNotConfiguredError();
  }
  if (!booking.roomId) {
    throw new Error('Booking has no room; call ensureBookingRoom first');
  }
  const now = opts.now ?? new Date();
  const opensAt = roomOpensAt(booking);
  const closesAt = roomClosesAt(booking);
  const phase = roomPhase(booking, now);
  if (phase !== 'open') {
    logJoinFailure(phase === 'not_open' ? 'room_not_open' : 'room_closed', {
      bookingId,
      room: booking.roomId,
      role,
      detail: phase === 'cancelled' ? 'booking_cancelled' : undefined,
    });
    throw new RoomWindowError(
      phase === 'not_open' ? 'room_not_open' : phase === 'cancelled' ? 'booking_cancelled' : 'room_closed',
      opensAt,
      closesAt,
    );
  }

  // Epic 4 guest gates, checked after the window so the answer
  // order stays time first, access second. A removed guest is
  // refused for good: their identity is on the booking's
  // removed list, which is the record that tells them apart
  // from a guest who merely dropped (a drop leaves no record
  // and mints again with the same link). A waiting room guest
  // is refused until the host admits them, so no publishing
  // token exists before admission, ever.
  if (role === 'guest') {
    if ((booking.removedIdentities ?? []).includes(guestIdentityFor(bookingId))) {
      logJoinFailure('removed', { bookingId, room: booking.roomId, role });
      throw new RoomAccessError('guest_removed');
    }
    if (
      booking.entryMode === 'waiting_room' &&
      booking.guestAdmissionState !== 'admitted'
    ) {
      logJoinFailure(
        booking.guestAdmissionState === 'denied' ? 'admission_denied' : 'admission_pending',
        {
          bookingId,
          room: booking.roomId,
          role,
          detail: booking.guestAdmissionState ?? 'none',
        },
      );
      throw new RoomAccessError('admission_required');
    }
  }

  const identity =
    role === 'host'
      ? hostIdentityFor(String(booking.hostId))
      : guestIdentityFor(bookingId);

  // The participant limit as product behavior (story 5.1.3):
  // count the real participants on the media server and refuse
  // the joiner past the booking's limit with room_full. When
  // the server cannot be asked (it is down, or the room does
  // not exist there yet), the mint proceeds: minting is local
  // signing, the pre-created server room still carries the
  // same cap for LiveKit to enforce at connect, and a count
  // outage must not lock everyone out of every meeting. The
  // skipped check is logged, never silent.
  const settings = resolveMeetingSettings(booking);
  try {
    const participants = await roomService(config).listParticipants(booking.roomId);
    if (
      isRoomFullFor(
        participants.map((p) => p.identity),
        identity,
        settings.participantLimit,
      )
    ) {
      logJoinFailure('room_full', {
        bookingId,
        room: booking.roomId,
        role,
        count: participants.length,
        limit: settings.participantLimit,
      });
      throw new RoomFullError(settings.participantLimit);
    }
  } catch (error) {
    if (error instanceof RoomFullError) throw error;
    if (!isRoomNotFoundError(error)) {
      logger.warn('participant count unavailable at mint; the full check was skipped', {
        event: 'room_full_check_failed',
        bookingId,
        room: booking.roomId,
        error: String(error),
      });
    }
  }

  const ttlSeconds = Math.min(
    TOKEN_MAX_TTL_SECONDS,
    Math.max(
      TOKEN_MIN_TTL_SECONDS,
      Math.floor((closesAt.getTime() + TOKEN_CLOSE_GRACE_MS - now.getTime()) / 1000),
    ),
  );
  const minted = await mintRoomToken(config, {
    room: booking.roomId,
    identity,
    name: opts.displayName,
    role,
    ttlSeconds,
  });

  logMeetingEvent('token_minted', {
    bookingId,
    room: booking.roomId,
    role,
    identity,
  });
  if (booking.roomStatus !== 'live') {
    booking.roomStatus = 'live';
    await booking.save();
    logMeetingEvent('room_opened', { bookingId, room: booking.roomId });
  }
  return {
    ...minted,
    url: config.url,
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
  };
}

/**
 * The host's extension: push roomExpiresAt later by the
 * booking's extension minutes, up to the booking's extension
 * count (Epic 5 settings; defaults 30 minutes, once).
 * Extending from before the room opens is allowed (it moves the
 * close, never the open); extending a cancelled or already closed
 * room is not. Returns the new expiry.
 */
export async function extendBookingRoom(
  booking: HydratedDocument<MeetBookingDoc>,
  now: Date = new Date(),
): Promise<Date> {
  if (booking.status === 'cancelled') {
    throw new RoomExtendError('booking_cancelled', 'This booking was cancelled');
  }
  const settings = resolveMeetingSettings(booking);
  const used = booking.roomExtensionsUsed ?? (booking.roomExtended ? 1 : 0);
  if (used >= settings.extensionsAllowed) {
    throw new RoomExtendError(
      'already_extended',
      settings.extensionsAllowed === 0
        ? 'Extensions are turned off for this meeting'
        : used === 1
          ? 'This room has already been extended once'
          : `This room has already been extended ${used} times`,
    );
  }
  const closesAt = roomClosesAt(booking);
  if (now.getTime() > closesAt.getTime()) {
    throw new RoomExtendError('room_closed', 'This room has already closed');
  }
  const next = new Date(closesAt.getTime() + settings.extensionMinutes * 60 * 1000);
  booking.roomExpiresAt = next;
  booking.roomExtensionsUsed = used + 1;
  booking.roomExtended = true;
  await booking.save();
  return next;
}
