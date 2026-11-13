import 'server-only';

import { randomUUID } from 'node:crypto';

import type { HydratedDocument } from 'mongoose';

import { getConfig, getLiveKitConfig } from '@/lib/config';
import { mintRoomToken, roomService, type MintedRoomToken, type RoomRole } from '@/lib/livekit';
import { logger } from '@/lib/log';
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
 *   - The room OPENS 5 minutes before the booking starts and
 *     CLOSES at roomExpiresAt, initially the booking end plus 15
 *     minutes. Both are enforced here, at mint time: no token is
 *     minted outside the window, and LiveKit itself needs no
 *     schedule.
 *   - An empty room stays open until expiry, so a dropped guest
 *     rejoins with the same link. Nothing closes a room early
 *     except host end (Epic 4) or cancellation.
 *   - The host can EXTEND once, pushing roomExpiresAt 30 minutes
 *     later. The endpoint lives in this epic; the in-room button
 *     is Epic 3.
 *   - Token TTL follows the Hub voice shape (1 hour) but is capped
 *     so a token never outlives its room by more than a short
 *     grace: a participant mid-call at close time is not cut off
 *     by token expiry, and nobody can sit on a token and rejoin a
 *     closed room with it (the mint gate is the window; the TTL
 *     cap keeps stale tokens from lingering past it).
 */

/** How long before the booking start the room opens. */
export const ROOM_OPEN_LEAD_MS = 5 * 60 * 1000;
/** How long after the booking end the room stays open, before any extension. */
export const ROOM_CLOSE_LAG_MS = 15 * 60 * 1000;
/** The host's one extension pushes expiry this far. */
export const ROOM_EXTEND_MS = 30 * 60 * 1000;
/** Meeting participant cap (spec decision 5), set on the LiveKit room at creation. */
export const ROOM_MAX_PARTICIPANTS = 10;

const TOKEN_MAX_TTL_SECONDS = 60 * 60; // the Hub voice token shape: 1 hour
const TOKEN_CLOSE_GRACE_MS = 30 * 60 * 1000;
const TOKEN_MIN_TTL_SECONDS = 60;

export class LiveKitNotConfiguredError extends Error {
  readonly code = 'livekit_not_configured';
  constructor() {
    super('Video rooms are not configured on this deployment');
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

export class RoomExtendError extends Error {
  readonly code: 'already_extended' | 'booking_cancelled' | 'room_closed';
  constructor(code: RoomExtendError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** When this booking's room opens: 5 minutes before it starts. */
export function roomOpensAt(booking: Pick<MeetBookingDoc, 'start'>): Date {
  return new Date(booking.start.getTime() - ROOM_OPEN_LEAD_MS);
}

/** The expiry a room gets at booking time: end plus the close lag. */
export function initialRoomExpiresAt(booking: Pick<MeetBookingDoc, 'end'>): Date {
  return new Date(booking.end.getTime() + ROOM_CLOSE_LAG_MS);
}

/** The current expiry, falling back to the initial one for bookings stamped before it was stored. */
export function roomClosesAt(booking: Pick<MeetBookingDoc, 'end' | 'roomExpiresAt'>): Date {
  return booking.roomExpiresAt ?? initialRoomExpiresAt(booking);
}

export type RoomPhase = 'not_open' | 'open' | 'closed' | 'cancelled';

/** Where the room is in its lifecycle at `now`. Pure, so it is testable without a database. */
export function roomPhase(
  booking: Pick<MeetBookingDoc, 'start' | 'end' | 'status' | 'roomStatus' | 'roomExpiresAt'>,
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
  await createLiveKitRoom(booking);
}

/**
 * Create the room on the LiveKit server, best effort. The room is
 * created with an empty timeout that reaches just past expiry, so
 * LiveKit itself drops an empty room once it has closed; a room
 * with participants in it is never dropped by that timer.
 */
export async function createLiveKitRoom(
  booking: Pick<MeetBookingDoc, 'roomId' | 'end' | 'roomExpiresAt'>,
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
      maxParticipants: ROOM_MAX_PARTICIPANTS,
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
 * Mint a token for this booking's room, enforcing the lifecycle
 * window. This is the ONLY path that mints meeting tokens, so the
 * window cannot be bypassed by a route forgetting to check it.
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
  const config = getLiveKitConfig();
  if (!config) throw new LiveKitNotConfiguredError();
  if (!booking.roomId) {
    throw new Error('Booking has no room; call ensureBookingRoom first');
  }
  const now = opts.now ?? new Date();
  const opensAt = roomOpensAt(booking);
  const closesAt = roomClosesAt(booking);
  const phase = roomPhase(booking, now);
  if (phase !== 'open') {
    throw new RoomWindowError(
      phase === 'not_open' ? 'room_not_open' : phase === 'cancelled' ? 'booking_cancelled' : 'room_closed',
      opensAt,
      closesAt,
    );
  }

  const ttlSeconds = Math.min(
    TOKEN_MAX_TTL_SECONDS,
    Math.max(
      TOKEN_MIN_TTL_SECONDS,
      Math.floor((closesAt.getTime() + TOKEN_CLOSE_GRACE_MS - now.getTime()) / 1000),
    ),
  );
  const identity =
    role === 'host' ? `host-${String(booking.hostId)}` : `guest-${String(booking._id)}`;
  const minted = await mintRoomToken(config, {
    room: booking.roomId,
    identity,
    name: opts.displayName,
    role,
    ttlSeconds,
  });

  if (booking.roomStatus !== 'live') {
    booking.roomStatus = 'live';
    await booking.save();
  }
  return {
    ...minted,
    url: config.url,
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
  };
}

/**
 * The host's one extension: push roomExpiresAt 30 minutes later.
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
  if (booking.roomExtended) {
    throw new RoomExtendError('already_extended', 'This room has already been extended once');
  }
  const closesAt = roomClosesAt(booking);
  if (now.getTime() > closesAt.getTime()) {
    throw new RoomExtendError('room_closed', 'This room has already closed');
  }
  const next = new Date(closesAt.getTime() + ROOM_EXTEND_MS);
  booking.roomExpiresAt = next;
  booking.roomExtended = true;
  await booking.save();
  return next;
}
