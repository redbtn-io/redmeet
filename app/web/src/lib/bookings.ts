import 'server-only';

import { randomUUID } from 'node:crypto';

import type { HydratedDocument } from 'mongoose';

import {
  availableSlots,
  normalizeAvailabilityWindows,
  parseTimeLabel,
  zonedTimeToUtcMs,
  type BookingInput,
  type BusyInterval,
  type Slot,
} from '@redmeet/core';

import { createCalendarEvent, deleteCalendarEvent, getBusyIntervals } from '@/lib/calendar';
import {
  CalendarNotConnectedError,
  resolveHostCalendarSelection,
} from '@/lib/calendar-auth';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/log';
import { deleteLiveKitRoom, ensureBookingRoom, guestJoinUrlFor, roomOpensAt } from '@/lib/rooms';
import {
  MeetBooking,
  SLOT_HOLDING_STATUSES,
  type MeetBookingDoc,
} from '@/models/meet-booking';
import type { MeetHostDoc } from '@/models/meet-host';
import { MeetType, type MeetTypeDoc } from '@/models/meet-type';

/**
 * Booking orchestration. Availability is the original's slot math over
 * two busy sources: the host's real calendars (gateway free/busy, read
 * under the host's OWN credential, merged across every ticked
 * (connection, calendar) pair in their selection, which can span all
 * of their linked google accounts) and this app's own bookings. If the
 * host has no connected calendar, or a connection cannot answer, the
 * app's own bookings still block their slots and the answer is
 * flagged degraded with `calendarConnected` saying which case it is;
 * availability never silently becomes "everything is free", and it
 * never reads anyone else's calendar.
 */

export interface AvailabilityResult {
  slots: Slot[];
  degraded: boolean;
  calendarConnected: boolean;
}

export async function busyForWindow(
  host: MeetHostDoc,
  timeMinMs: number,
  timeMaxMs: number,
): Promise<{ busy: BusyInterval[]; degraded: boolean; calendarConnected: boolean }> {
  await getDb();
  const own = await MeetBooking.find({
    hostId: host._id,
    // Every live status holds its slot, calendar_failed included: a
    // booking whose invite failed is still a booking, and its slot
    // must not be handed to a second guest while it waits for a retry.
    status: { $in: SLOT_HOLDING_STATUSES },
    start: { $lt: new Date(timeMaxMs) },
    end: { $gt: new Date(timeMinMs) },
  });
  const busy: BusyInterval[] = own.map((b) => ({
    startMs: b.start.getTime(),
    endMs: b.end.getTime(),
  }));
  const resolved = await resolveHostCalendarSelection(host);
  if (!resolved) {
    return { busy, degraded: true, calendarConnected: false };
  }
  // One free/busy query per connection, with that connection's header,
  // merged into a single busy set. A connection that fails degrades
  // the answer (its calendars may be under-blocking) but never sinks
  // the others, and the failure is flagged, not hidden.
  const byConnection = new Map<string, string[]>();
  for (const entry of resolved.selection) {
    const ids = byConnection.get(entry.connectionId) ?? [];
    ids.push(entry.calendarId);
    byConnection.set(entry.connectionId, ids);
  }
  let degraded = false;
  for (const [connectionId, calendarIds] of byConnection) {
    try {
      const calendarBusy = await getBusyIntervals(
        { token: resolved.token, connectionId },
        host.timeZone,
        calendarIds,
        timeMinMs,
        timeMaxMs,
      );
      busy.push(...calendarBusy);
    } catch (error) {
      degraded = true;
      logger.warn('freebusy unavailable for one connection, continuing with the rest', {
        error: String(error),
      });
    }
  }
  return { busy, degraded, calendarConnected: true };
}

export async function availabilityFor(
  host: MeetHostDoc,
  type: MeetTypeDoc,
  date: string,
): Promise<AvailabilityResult> {
  const dayStart = zonedTimeToUtcMs(date, 0, host.timeZone);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const { busy, degraded, calendarConnected } = await busyForWindow(host, dayStart, dayEnd);
  const slots = availableSlots({
    date,
    durationMinutes: type.lengthMinutes,
    busy,
    nowMs: Date.now(),
    timeZone: host.timeZone,
    windows: normalizeAvailabilityWindows(host.availabilityWindows),
  });
  return { slots, degraded, calendarConnected };
}

export class BookingConflictError extends Error {}

/**
 * One calendar write attempt for a booking that already exists.
 * Updates the booking's status, attempt counter, and error in place
 * and saves. Returns where the booking landed:
 *
 *   confirmed  the event is on the host's calendar, invite sent
 *   pending    the host has no connected calendar; the booking stands
 *              as a redMeet booking and blocks its slot
 *   failed     the write was attempted and failed; the booking keeps
 *              its slot and waits for a retry
 */
export async function attemptCalendarWrite(
  host: MeetHostDoc,
  type: MeetTypeDoc,
  booking: HydratedDocument<MeetBookingDoc>,
): Promise<'confirmed' | 'pending' | 'failed'> {
  const resolved = await resolveHostCalendarSelection(host);
  if (!resolved) {
    // No calendar to write to: the booking stands as a redMeet booking
    // (it blocks the slot), honestly flagged as not on a calendar. It
    // must NOT be written to anyone else's calendar.
    booking.status = 'pending_calendar';
    booking.calendarError = 'Host calendar not connected';
    await booking.save();
    return 'pending';
  }

  // The calendar event carries the guest's join link (Epic 2,
  // feature 2.3). Bookings made before rooms existed, or whose
  // room stamp failed at creation, are stamped lazily here, so a
  // retry or a reconciliation rescue writes an event WITH the
  // link. A stamp failure never sinks the calendar write: the
  // event falls back to the plain 'Virtual' location, honestly.
  if (!booking.roomId) {
    try {
      await ensureBookingRoom(booking, type);
    } catch (error) {
      logger.error('lazy room stamp failed before calendar write', {
        bookingId: String(booking._id),
        error: String(error),
      });
    }
  }
  const joinUrl = guestJoinUrlFor(booking) ?? '';

  booking.calendarAttempts = (booking.calendarAttempts ?? 0) + 1;
  booking.lastCalendarAttemptAt = new Date();
  try {
    const { eventId, calendarId } = await createCalendarEvent(
      { token: resolved.token, connectionId: resolved.writeTarget.connectionId },
      host.timeZone,
      resolved.writeTarget.calendarId,
      {
        summary: `${type.name} with ${booking.guestName}`,
        description: [
          `${booking.guestName}${booking.guestPhone ? `, ${booking.guestPhone}` : ''}`,
          booking.comments ? `Comments: ${booking.comments}` : '',
          joinUrl ? `Join: ${joinUrl}` : '',
          `Booked via redMeet (https://meet.redbtn.io/${host.slug}/${type.slug})`,
        ]
          .filter(Boolean)
          .join('\n'),
        // The join link IS the location now: calendar clients
        // render it as a clickable link. Only a booking with no
        // room stamped keeps the old plain 'Virtual'.
        location: joinUrl || 'Virtual',
        startMs: booking.start.getTime(),
        endMs: booking.end.getTime(),
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        guestPhone: booking.guestPhone ?? '',
        comments: booking.comments ?? '',
        joinUrl,
      },
    );
    booking.status = 'confirmed';
    booking.calendarEventId = eventId;
    booking.calendarId = calendarId;
    booking.calendarError = undefined;
    await booking.save();
    return 'confirmed';
  } catch (error) {
    if (error instanceof CalendarNotConnectedError) {
      booking.status = 'pending_calendar';
      booking.calendarError = 'Host calendar not connected';
      await booking.save();
      return 'pending';
    }
    booking.status = 'calendar_failed';
    booking.calendarError = String(error).slice(0, 500);
    logger.error('calendar write failed for booking', {
      bookingId: String(booking._id),
      attempt: booking.calendarAttempts,
      error: booking.calendarError,
    });
    await booking.save();
    return 'failed';
  }
}

/**
 * Book one slot. The offered slot is recomputed server-side and must
 * match the guest's pick exactly; then the slot is CLAIMED atomically
 * and the calendar event written. The returned booking carries its
 * true status.
 *
 * The claim is a findOneAndUpdate upsert against the partial unique
 * index on (hostId, start) over the live statuses: if a live booking
 * already holds the slot, the filter matches it and the upsert
 * returns that booking untouched, which the claim token detects; if
 * two claims race past the filter, the unique index lets exactly one
 * insert through and the loser gets a duplicate key error. Either way
 * exactly one booking holds the slot, and the loser is a 409.
 */
export async function createBooking(
  host: MeetHostDoc,
  type: MeetTypeDoc,
  input: BookingInput,
): Promise<HydratedDocument<MeetBookingDoc>> {
  const minutes = parseTimeLabel(input.time);
  if (minutes === null) throw new BookingConflictError('That time is not a bookable slot');
  const startMs = zonedTimeToUtcMs(input.date, minutes, host.timeZone);

  const { slots } = await availabilityFor(host, type, input.date);
  const slot = slots.find((s) => s.startMs === startMs);
  if (!slot) {
    throw new BookingConflictError('That slot was just taken or is no longer available');
  }

  await getDb();
  const claimToken = randomUUID();
  let booking: HydratedDocument<MeetBookingDoc> | null;
  try {
    booking = await MeetBooking.findOneAndUpdate(
      {
        hostId: host._id,
        start: new Date(slot.startMs),
        status: { $in: SLOT_HOLDING_STATUSES },
      },
      {
        $setOnInsert: {
          hostId: host._id,
          meetTypeId: type._id,
          guestName: input.name,
          guestEmail: input.email,
          guestPhone: input.phone ?? '',
          comments: input.comments ?? '',
          start: new Date(slot.startMs),
          end: new Date(slot.endMs),
          status: 'pending_calendar',
          claimToken,
          calendarAttempts: 0,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new BookingConflictError('That slot was just taken or is no longer available');
    }
    throw error;
  }
  if (!booking || booking.claimToken !== claimToken) {
    // The upsert matched a live booking that already holds this slot.
    throw new BookingConflictError('That slot was just taken or is no longer available');
  }

  // The room is created at booking time (Epic 1, story 1.3.1), so
  // the join link is stable from this moment and the calendar event
  // can carry it later. A room failure never sinks the booking:
  // the token endpoints stamp lazily for any booking missing its
  // room, and LiveKit creates the room at first join regardless.
  try {
    await ensureBookingRoom(booking, type);
  } catch (error) {
    logger.error('room creation failed for booking; it will be stamped lazily', {
      bookingId: String(booking._id),
      error: String(error),
    });
  }

  await attemptCalendarWrite(host, type, booking);
  return booking;
}

/** Total calendar write attempts the automatic sweep will make
 *  (the initial write plus its retries) before it leaves a failed
 *  booking alone with its badge. Manual retries are the host's call
 *  and are not capped by this. */
export const MAX_AUTO_CALENDAR_ATTEMPTS = 4;

const RETRY_DELAYS_MS = [1000, 3000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry the calendar write for a booking whose invite did not land.
 * Up to 3 attempts with backoff inside the call. With `auto: true`
 * (the reconciliation sweep) the total attempt budget is capped at
 * MAX_AUTO_CALENDAR_ATTEMPTS; a manual retry from the dashboard is
 * the host explicitly asking, so it always runs.
 */
export async function retryBookingCalendar(
  host: MeetHostDoc,
  booking: HydratedDocument<MeetBookingDoc>,
  opts: { auto?: boolean } = {},
): Promise<HydratedDocument<MeetBookingDoc>> {
  if (booking.status === 'confirmed' || booking.status === 'cancelled') return booking;
  if (opts.auto && (booking.calendarAttempts ?? 0) >= MAX_AUTO_CALENDAR_ATTEMPTS) {
    return booking;
  }
  await getDb();
  const type = await MeetType.findById(booking.meetTypeId);
  if (!type) {
    booking.calendarError = 'Meeting type no longer exists';
    await booking.save();
    return booking;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 3000);
    const outcome = await attemptCalendarWrite(host, type, booking);
    if (outcome !== 'failed') break;
    if (opts.auto && (booking.calendarAttempts ?? 0) >= MAX_AUTO_CALENDAR_ATTEMPTS) break;
  }
  return booking;
}

/**
 * Cancel a booking from the host's side. The calendar event is
 * deleted first (the guest gets the cancellation from Google, the
 * same channel that invited them); then the booking is marked
 * cancelled, which drops it out of the slot holding index and the
 * busy computation, so the slot is bookable again.
 *
 * If the event delete fails, the booking is STILL cancelled locally
 * (the host's decision stands) and the failure is kept in
 * calendarError with `calendarRemoved: false`, because the leftover
 * event will keep showing the slot busy on the host's calendar until
 * it is removed there.
 */
export async function cancelBooking(
  host: MeetHostDoc,
  booking: HydratedDocument<MeetBookingDoc>,
): Promise<{ booking: MeetBookingDoc; calendarRemoved: boolean | null }> {
  if (booking.status === 'cancelled') return { booking, calendarRemoved: null };

  let calendarRemoved: boolean | null = null;
  if (booking.calendarEventId && booking.calendarId) {
    calendarRemoved = false;
    const resolved = await resolveHostCalendarSelection(host);
    if (resolved) {
      try {
        await deleteCalendarEvent(
          { token: resolved.token, connectionId: resolved.writeTarget.connectionId },
          booking.calendarId,
          booking.calendarEventId,
        );
        calendarRemoved = true;
      } catch (error) {
        booking.calendarError =
          `Booking cancelled, but removing the calendar event failed: ${String(error).slice(0, 300)}`;
        logger.error('calendar delete failed for cancelled booking', {
          bookingId: String(booking._id),
          error: String(error),
        });
      }
    }
  }

  booking.status = 'cancelled';
  booking.cancelledAt = new Date();
  // The room closes with the booking: the mint gate refuses a
  // cancelled booking outright, and the LiveKit room is deleted so
  // nothing lingers joinable on the media server.
  booking.roomStatus = 'closed';
  if (calendarRemoved !== false) booking.calendarError = undefined;
  await booking.save();
  await deleteLiveKitRoom(booking.roomId);
  return { booking, calendarRemoved };
}

export function bookingJson(booking: MeetBookingDoc, type?: MeetTypeDoc) {
  return {
    id: String(booking._id),
    guestName: booking.guestName,
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone,
    comments: booking.comments,
    start: booking.start.toISOString(),
    end: booking.end.toISOString(),
    status: booking.status,
    meetingName: type?.name ?? '',
    meetingSlug: type?.slug ?? '',
    calendarEventId: booking.calendarEventId ?? null,
    calendarError: booking.calendarError ?? null,
    calendarAttempts: booking.calendarAttempts ?? 0,
    // Room fields (Epic 1). The guest join token is included
    // because every audience of this JSON already owns it: the
    // guest who just booked gets their own link back, and the
    // host's dashboard gets the link they share. The HOST join
    // token is not here; the host's path is their session.
    roomId: booking.roomId ?? null,
    roomUrl: booking.roomUrl ?? null,
    roomStatus: booking.roomStatus ?? 'not_created',
    roomProvider: booking.roomProvider ?? 'livekit',
    guestJoinToken: booking.guestJoinToken ?? null,
    // The guest's full join link (Epic 2), for the confirmation
    // page and the host's share action. Null until the room is
    // stamped.
    guestJoinUrl: guestJoinUrlFor(booking),
    roomOpensAt: roomOpensAt(booking).toISOString(),
    roomExpiresAt: booking.roomExpiresAt ? booking.roomExpiresAt.toISOString() : null,
    roomExtended: booking.roomExtended ?? false,
  };
}
