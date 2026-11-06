import 'server-only';

import {
  availableSlots,
  normalizeAvailabilityWindows,
  parseTimeLabel,
  zonedTimeToUtcMs,
  type BookingInput,
  type BusyInterval,
  type Slot,
} from '@redmeet/core';

import { createCalendarEvent, getBusyIntervals } from '@/lib/calendar';
import {
  CalendarNotConnectedError,
  resolveHostCalendarSelection,
} from '@/lib/calendar-auth';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/log';
import { MeetBooking, type MeetBookingDoc } from '@/models/meet-booking';
import type { MeetHostDoc } from '@/models/meet-host';
import type { MeetTypeDoc } from '@/models/meet-type';

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
    status: { $in: ['pending_calendar', 'confirmed'] },
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
 * Book one slot. The offered slot is recomputed server-side and must
 * match the guest's pick exactly; then the booking is recorded and the
 * calendar event written. The returned booking carries its true status.
 */
export async function createBooking(
  host: MeetHostDoc,
  type: MeetTypeDoc,
  input: BookingInput,
): Promise<MeetBookingDoc> {
  const minutes = parseTimeLabel(input.time);
  if (minutes === null) throw new BookingConflictError('That time is not a bookable slot');
  const startMs = zonedTimeToUtcMs(input.date, minutes, host.timeZone);

  const { slots } = await availabilityFor(host, type, input.date);
  const slot = slots.find((s) => s.startMs === startMs);
  if (!slot) {
    throw new BookingConflictError('That slot was just taken or is no longer available');
  }

  await getDb();
  const booking = await MeetBooking.create({
    hostId: host._id,
    meetTypeId: type._id,
    guestName: input.name,
    guestEmail: input.email,
    guestPhone: input.phone ?? '',
    comments: input.comments ?? '',
    start: new Date(slot.startMs),
    end: new Date(slot.endMs),
    status: 'pending_calendar',
  });

  const resolved = await resolveHostCalendarSelection(host);
  if (!resolved) {
    // No calendar to write to: the booking stands as a redMeet booking
    // (it blocks the slot), honestly flagged as not on a calendar. It
    // must NOT be written to anyone else's calendar.
    booking.status = 'pending_calendar';
    booking.calendarError = 'Host calendar not connected';
    await booking.save();
    return booking;
  }

  try {
    const { eventId, calendarId } = await createCalendarEvent(
      { token: resolved.token, connectionId: resolved.writeTarget.connectionId },
      host.timeZone,
      resolved.writeTarget.calendarId,
      {
        summary: `${type.name} with ${input.name}`,
        description: [
          `${input.name}${input.phone ? `, ${input.phone}` : ''}`,
          input.comments ? `Comments: ${input.comments}` : '',
          `Booked via redMeet (https://meet.redbtn.io/${host.slug}/${type.slug})`,
        ]
          .filter(Boolean)
          .join('\n'),
        location: 'Virtual',
        startMs: slot.startMs,
        endMs: slot.endMs,
        guestName: input.name,
        guestEmail: input.email,
        guestPhone: input.phone ?? '',
        comments: input.comments ?? '',
      },
    );
    booking.status = 'confirmed';
    booking.calendarEventId = eventId;
    booking.calendarId = calendarId;
  } catch (error) {
    if (error instanceof CalendarNotConnectedError) {
      booking.status = 'pending_calendar';
      booking.calendarError = 'Host calendar not connected';
    } else {
      booking.status = 'calendar_failed';
      booking.calendarError = String(error).slice(0, 500);
      logger.error('calendar write failed for booking', {
        bookingId: String(booking._id),
        error: booking.calendarError,
      });
    }
  }
  await booking.save();
  return booking;
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
  };
}
