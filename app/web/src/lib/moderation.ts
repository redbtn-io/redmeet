import 'server-only';

import { TrackSource } from 'livekit-server-sdk';

import type { HydratedDocument } from 'mongoose';

import { getLiveKitConfig } from '@/lib/config';
import { logJoinFailure, logMeetingEvent } from '@/lib/join-events';
import { roomService } from '@/lib/livekit';
import { logger } from '@/lib/log';
import { stopRecordingIfActive } from '@/lib/recording';
import {
  LiveKitNotConfiguredError,
  LiveKitUnreachableError,
  RoomWindowError,
  RoomAccessError,
  deleteLiveKitRoom,
  guestIdentityFor,
  roomClosesAt,
  roomOpensAt,
  roomPhase,
} from '@/lib/rooms';
import type { MeetBookingDoc } from '@/models/meet-booking';

/**
 * Host moderation (Epic 4): mute, mute all, remove, end, and
 * the waiting room decisions.
 *
 * Every effect that can be server side IS server side. Mute
 * and remove and end go through the LiveKit server API
 * (RoomServiceClient), never through a data message the
 * participant's own client is trusted to obey, so a modified
 * client cannot ignore them. The state that must outlive the
 * room (the removal record, the admission decision, the
 * closed room) lives on the booking, and the mint in
 * lib/rooms.ts enforces it.
 *
 * The route layer owns the session gate and the owner scope;
 * everything here assumes the caller already proved they are
 * the host who owns the booking.
 *
 * Error behavior (Epic 5): no moderation action surfaces a
 * raw failure when the media server is unreachable. The
 * actions that must ask the server first (mute, mute all)
 * answer with the same clean 409 shape the single mute path
 * has always had, participant_not_found when the lookup
 * fails, livekit_unreachable when the mute itself cannot be
 * delivered. Remove and end never depended on the server
 * answering: the removal record and the closed booking are
 * written first and stand either way.
 *
 * Every action and every admission decision is logged in the
 * Epic 5 shape (lib/join-events.ts).
 */

export type ModerationCode =
  | 'participant_not_found'
  | 'no_microphone'
  | 'guest_not_waiting'
  | 'not_waiting_room';

export class ModerationError extends Error {
  readonly code: ModerationCode;
  constructor(code: ModerationCode, message: string) {
    super(message);
    this.code = code;
  }
}

type Booking = HydratedDocument<MeetBookingDoc>;

function service() {
  const config = getLiveKitConfig();
  if (!config) throw new LiveKitNotConfiguredError();
  return roomService(config);
}

function bookingIdOf(booking: Booking): string {
  return String(booking._id);
}

/**
 * Mute one participant's microphone, server side. The track is
 * muted on the LiveKit server; the participant's client sees
 * its own track muted and shows "The host muted you" (the room
 * UI watches for exactly that), and the participant can unmute
 * themselves afterwards through their normal publish path.
 */
export async function muteParticipantMic(booking: Booking, identity: string): Promise<void> {
  if (!booking.roomId) {
    throw new ModerationError('participant_not_found', 'That person is not in the meeting right now');
  }
  const svc = service();
  let participants;
  try {
    participants = await svc.listParticipants(booking.roomId);
  } catch (error) {
    logger.warn('moderation listParticipants failed', { roomId: booking.roomId, error: String(error) });
    throw new ModerationError('participant_not_found', 'That person is not in the meeting right now');
  }
  const participant = participants.find((p) => p.identity === identity);
  if (!participant) {
    throw new ModerationError('participant_not_found', 'That person is not in the meeting right now');
  }
  const mic = participant.tracks.find((t) => t.source === TrackSource.MICROPHONE);
  if (!mic) {
    throw new ModerationError('no_microphone', 'That person has no microphone on to mute');
  }
  if (mic.muted) return; // Already muted is the state the host asked for.
  try {
    await svc.mutePublishedTrack(booking.roomId, identity, mic.sid, true);
  } catch (error) {
    logger.warn('moderation mutePublishedTrack failed', {
      roomId: booking.roomId,
      identity,
      error: String(error),
    });
    throw new LiveKitUnreachableError();
  }
  logMeetingEvent('moderation', {
    bookingId: bookingIdOf(booking),
    room: booking.roomId,
    action: 'mute',
    identity,
  });
}

/**
 * Mute every guest's microphone (story 4.1.3). The host's own
 * mic is theirs to run, so host identities are skipped.
 * Returns how many microphones were muted by this call.
 *
 * Epic 5: the participant list call is wrapped like every
 * other moderation call now. Before this epic it was the one
 * unwrapped call in the module, so an unreachable media
 * server surfaced as a raw 500 from the route; now it answers
 * the same clean 409 family as the single mute.
 */
export async function muteAllGuests(booking: Booking): Promise<number> {
  if (!booking.roomId) return 0;
  const svc = service();
  let participants;
  try {
    participants = await svc.listParticipants(booking.roomId);
  } catch (error) {
    logger.warn('moderation mute-all listParticipants failed', {
      roomId: booking.roomId,
      error: String(error),
    });
    throw new LiveKitUnreachableError();
  }
  let muted = 0;
  for (const participant of participants) {
    if (participant.identity.startsWith('host-')) continue;
    const mic = participant.tracks.find(
      (t) => t.source === TrackSource.MICROPHONE && !t.muted,
    );
    if (!mic) continue;
    try {
      await svc.mutePublishedTrack(booking.roomId, participant.identity, mic.sid, true);
    } catch (error) {
      logger.warn('moderation mute-all mutePublishedTrack failed', {
        roomId: booking.roomId,
        identity: participant.identity,
        error: String(error),
      });
      throw new LiveKitUnreachableError();
    }
    muted += 1;
  }
  logMeetingEvent('moderation', {
    bookingId: bookingIdOf(booking),
    room: booking.roomId,
    action: 'mute_all',
    detail: `muted_${muted}`,
  });
  return muted;
}

/**
 * Remove a participant (story 4.2.1). The removal is RECORDED
 * on the booking first, and only then is the participant
 * disconnected: the record is what makes the removal stick,
 * because the mint refuses a recorded identity for good,
 * while a participant who merely dropped has no record and
 * rejoins with the same link. Recording first also closes the
 * race where a fast rejoin slips in between the disconnect
 * and the write.
 */
export async function removeParticipantFromRoom(
  booking: Booking,
  identity: string,
): Promise<void> {
  const current = booking.removedIdentities ?? [];
  if (!current.includes(identity)) {
    booking.removedIdentities = [...current, identity];
    await booking.save();
  }
  logMeetingEvent('moderation', {
    bookingId: bookingIdOf(booking),
    room: booking.roomId,
    action: 'remove',
    identity,
  });
  if (!booking.roomId) return;
  try {
    await service().removeParticipant(booking.roomId, identity);
  } catch (error) {
    // Not in the room right now (already dropped): the record
    // above still stands, so the link stays dead either way.
    logger.warn('removeParticipant found nobody in the room; the record stands', {
      roomId: booking.roomId,
      identity,
      error: String(error),
    });
  }
}

/**
 * End the meeting for everyone (story 4.2.2). The booking's
 * room is marked closed FIRST, which ends the token window
 * with it (the mint reads roomStatus), and then the LiveKit
 * room is deleted, which disconnects every participant where
 * they sit. Their clients check the booking on the way out
 * and land on "The meeting ended".
 */
export async function endMeeting(booking: Booking): Promise<void> {
  // A live recording stops with the meeting (Epic 6): the
  // file keeps settling onto the booking afterwards through
  // the refresh paths, so ending never waits on Egress.
  await stopRecordingIfActive(booking, 'meeting_ended');
  booking.roomStatus = 'closed';
  booking.roomEndedAt = new Date();
  await booking.save();
  logMeetingEvent('room_closed', {
    bookingId: bookingIdOf(booking),
    room: booking.roomId,
    detail: 'host_ended',
  });
  await deleteLiveKitRoom(booking.roomId);
}

/**
 * The guest asks to be let in (feature 4.3). Only inside the
 * room window, only in a waiting room meeting, and never for
 * a removed guest: the same checks the mint makes, in the
 * same order, so asking and joining can never disagree.
 * Asking again after a denial is a fresh ask.
 */
export async function requestAdmission(
  booking: Booking,
  name: string,
  now: Date = new Date(),
): Promise<void> {
  if (booking.entryMode !== 'waiting_room') {
    throw new ModerationError('not_waiting_room', 'This meeting does not use a waiting room');
  }
  const phase = roomPhase(booking, now);
  if (phase !== 'open') {
    throw new RoomWindowError(
      phase === 'not_open' ? 'room_not_open' : phase === 'cancelled' ? 'booking_cancelled' : 'room_closed',
      roomOpensAt(booking),
      roomClosesAt(booking),
    );
  }
  if ((booking.removedIdentities ?? []).includes(guestIdentityFor(String(booking._id)))) {
    throw new RoomAccessError('guest_removed');
  }
  booking.guestAdmissionState = 'waiting';
  booking.guestAdmissionName = name.trim().slice(0, 120) || booking.guestName;
  booking.guestAdmissionRequestedAt = now;
  booking.guestAdmissionDecidedAt = undefined;
  await booking.save();
  logMeetingEvent('admission', {
    bookingId: bookingIdOf(booking),
    room: booking.roomId,
    role: 'guest',
    action: 'requested',
  });
}

/** The host lets the waiting guest in (story 4.3.3). */
export async function admitGuest(booking: Booking): Promise<void> {
  if (booking.guestAdmissionState !== 'waiting') {
    throw new ModerationError('guest_not_waiting', 'No guest is waiting to be let in');
  }
  booking.guestAdmissionState = 'admitted';
  booking.guestAdmissionDecidedAt = new Date();
  await booking.save();
  logMeetingEvent('admission', {
    bookingId: bookingIdOf(booking),
    room: booking.roomId,
    action: 'admitted',
  });
}

/** The host turns the waiting guest away (story 4.3.3). */
export async function denyGuest(booking: Booking): Promise<void> {
  if (booking.guestAdmissionState !== 'waiting') {
    throw new ModerationError('guest_not_waiting', 'No guest is waiting to be let in');
  }
  booking.guestAdmissionState = 'denied';
  booking.guestAdmissionDecidedAt = new Date();
  await booking.save();
  logMeetingEvent('admission', {
    bookingId: bookingIdOf(booking),
    room: booking.roomId,
    action: 'denied',
  });
  logJoinFailure('admission_denied', {
    bookingId: bookingIdOf(booking),
    room: booking.roomId,
    role: 'guest',
  });
}
