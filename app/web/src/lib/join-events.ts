import 'server-only';

import { logger } from '@/lib/log';

/**
 * Join observability (Epic 5, stories 5.1.2 and 5.1.4).
 *
 * One log shape for everything a meeting does after Epic 5:
 * the lines the earlier epics emitted were shaped case by
 * case, so "did anyone join, and if not, why not" meant
 * reading four modules. Now the room lifecycle, the joins,
 * the token mints, the moderation actions, and every join
 * failure go through here and land on the same fields:
 *
 *   event     what happened, from a small fixed set
 *   bookingId the booking that owns the room, when there is one
 *   room      the LiveKit room name, when there is one
 *   role      'host' or 'guest', when a person is involved
 *   type      for failures, the failure vocabulary below
 *   action    for moderation and admission, which action
 *   detail    a short machine string, never prose with data in it
 *
 * The lines go where every redMeet log line goes today: the
 * container's stdout as JSON, which redRun collects. No new
 * plumbing, no log platform.
 *
 * THE RULE, absolute: no token values, no secrets, and no
 * guest join tokens ever appear in these fields. Identities
 * are safe to log (they are derived from ids the logs already
 * carry: host-<hostId>, guest-<bookingId>), names and emails
 * are not logged here at all, and a test in ops.test.ts mints
 * a real token through the real path and asserts the token
 * string appears in no emitted line.
 */

export type MeetingEvent =
  | 'room_created'
  | 'room_opened'
  | 'room_closed'
  | 'participant_joined'
  | 'participant_left'
  | 'token_minted'
  | 'moderation'
  | 'admission';

export interface MeetingEventFields {
  bookingId?: string;
  room?: string;
  role?: 'host' | 'guest';
  identity?: string;
  action?: string;
  detail?: string;
}

export function logMeetingEvent(event: MeetingEvent, fields: MeetingEventFields = {}): void {
  logger.info(`meeting ${event}`, { event, ...fields });
}

/**
 * The join failure vocabulary (story 5.1.4). Every refusal a
 * guest or host can hit maps to exactly one of these, so a
 * network or TURN problem (livekit_unreachable, browser
 * blocked) can be told apart from a credential problem (bad
 * token) in the logs instead of all reading as "join failed".
 *
 *   bad_token            the join link credential did not match
 *   room_not_open        too early, the window has not opened
 *   room_closed          too late, or the booking was cancelled
 *   room_full            the participant limit is reached
 *   removed              the host removed this guest
 *   admission_pending    waiting room, the host has not admitted yet
 *   admission_denied     waiting room, the host said no
 *   livekit_unreachable  the media server could not be reached or asked
 *   browser_blocked      the browser blocked camera or mic, or has none
 */
export const JOIN_FAILURE_TYPES = [
  'bad_token',
  'room_not_open',
  'room_closed',
  'room_full',
  'removed',
  'admission_pending',
  'admission_denied',
  'livekit_unreachable',
  'browser_blocked',
] as const;

export type JoinFailureType = (typeof JOIN_FAILURE_TYPES)[number];

export function isJoinFailureType(value: unknown): value is JoinFailureType {
  return (
    typeof value === 'string' && (JOIN_FAILURE_TYPES as readonly string[]).includes(value)
  );
}

export interface JoinFailureFields extends MeetingEventFields {
  /** Extra structured context, for example the participant count on a full room. */
  count?: number;
  limit?: number;
}

/**
 * Log one join failure. Failure lines are warnings, not
 * errors: a guest with a bad link is the system working, and
 * the errors stay reserved for the app itself breaking.
 */
export function logJoinFailure(type: JoinFailureType, fields: JoinFailureFields = {}): void {
  logger.warn('join failed', { event: 'join_failed', type, ...fields });
}
