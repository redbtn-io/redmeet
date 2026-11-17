import 'server-only';

import type { HydratedDocument } from 'mongoose';

import { resolveMeetingSettings, type MeetingSettings } from '@/lib/meeting-settings';
import { ensureBookingRoom } from '@/lib/rooms';
import { MeetBooking, type MeetBookingDoc } from '@/models/meet-booking';
import type { MeetHostDoc } from '@/models/meet-host';
import type { EntryMode } from '@/models/meet-type';

/**
 * Instant meetings (Epic 8).
 *
 * A booked meeting is born from a slot: a guest picks a time on
 * a meeting type, the slot is claimed, a calendar invite goes
 * out. An instant meeting skips all of that. The host starts one
 * and gets a room that is open right now and a share link to
 * hand to whoever they want in it.
 *
 * The record is a MeetBooking with kind 'instant', on purpose:
 * every room path in the product (the mint, moderation, the
 * waiting room, recording, extensions, the join page) is keyed
 * on a booking record, and an instant meeting needs all of them
 * to work exactly like a booked one. What makes it instant is
 * what it does NOT have and what its fields say instead:
 *
 *   - No meeting type, no slot, no calendar. The status is
 *     'instant', which is not one of the slot holding statuses,
 *     so the record never claims a slot in the partial unique
 *     index, never shows up as busy in the host's availability,
 *     and never enters the calendar reconciliation sweep.
 *   - No named guest. guestName and guestEmail stay empty; the
 *     guestJoinToken is a SHARE token here, not one guest's
 *     credential. Each guest who opens the link gets their own
 *     identity from their own guest key (see lib/rooms.ts), so
 *     the one link seats many guests at once.
 *   - The window is a lifetime, not a schedule: it opens at
 *     creation (open lead stamped 0) and closes
 *     instantLifetimeMinutes later (close lag stamped 0), from
 *     the meeting settings defaults. The host can still end it
 *     early with the usual end action, and the usual extension
 *     can push the close later.
 *
 * Settings resolve through lib/meeting-settings.ts like every
 * other meeting: the defaults today, per host overrides later
 * if a surface ever offers them, stamped on the record at
 * creation so the meeting keeps the numbers it started with.
 */
export async function createInstantMeeting(
  host: HydratedDocument<MeetHostDoc>,
  input: {
    title?: string;
    entryMode?: EntryMode;
    /** Auto record (Epic 9): the host's choice at creation, default off. */
    recordAutomatically?: boolean;
    settings?: Partial<MeetingSettings>;
    now?: Date;
  } = {},
): Promise<HydratedDocument<MeetBookingDoc>> {
  const settings = resolveMeetingSettings(input.settings ?? null);
  const now = input.now ?? new Date();
  const end = new Date(now.getTime() + settings.instantLifetimeMinutes * 60 * 1000);
  const booking = await MeetBooking.create({
    hostId: host._id,
    kind: 'instant',
    status: 'instant',
    title: (input.title ?? '').trim().slice(0, 120),
    guestName: '',
    guestEmail: '',
    guestPhone: '',
    comments: '',
    start: now,
    end,
    calendarAttempts: 0,
    entryMode: input.entryMode === 'waiting_room' ? 'waiting_room' : 'open',
    participantLimit: settings.participantLimit,
    openLeadMinutes: 0,
    closeLagMinutes: 0,
    extensionMinutes: settings.extensionMinutes,
    extensionsAllowed: settings.extensionsAllowed,
    recordAutomatically: input.recordAutomatically ?? settings.recordAutomatically,
    roomExtensionsUsed: 0,
  });
  // Stamps the room fields, the share token, and roomExpiresAt
  // (end plus the stamped close lag of 0, so the room closes
  // exactly at the lifetime), and pre creates the LiveKit room.
  await ensureBookingRoom(booking);
  return booking;
}
