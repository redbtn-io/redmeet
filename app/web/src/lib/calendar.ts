import 'server-only';

import type { BusyInterval } from '@redmeet/core';

import { callGatewayTool } from '@/lib/gateway';
import { logger } from '@/lib/log';
import type { MeetHostDoc } from '@/models/meet-host';

/**
 * Calendar access through redbtn's own connections: the MCP gateway's
 * `google/calendar` namespace, server-side only.
 *
 * V1 tenancy, stated plainly: the app PAT belongs to George, so these
 * calls act on HIS linked Google accounts. A host whose
 * `googleConnectionId` names one of those connections gets their real
 * calendar; `useAccount` switches the gateway default for the caller,
 * which is safe in v1 because the PAT has exactly one owner. Per-host
 * PATs are the seam that removes this limit.
 */

const NAMESPACE = 'google/calendar';

let accountPrimedFor: string | null = null;

async function useAccount(host: MeetHostDoc): Promise<void> {
  const connectionId = host.googleConnectionId;
  if (!connectionId || accountPrimedFor === connectionId) return;
  await callGatewayTool(NAMESPACE, 'google_account_use', { connectionId });
  accountPrimedFor = connectionId;
}

interface FreeBusyAnswer {
  calendars?: Record<
    string,
    { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }
  >;
}

/**
 * Busy intervals across the host's calendars for a window. Throws on
 * gateway failure; callers decide whether to degrade (the booking flow
 * falls back to the app's own confirmed bookings, never to "all free").
 */
export async function getBusyIntervals(
  host: MeetHostDoc,
  timeMinMs: number,
  timeMaxMs: number,
): Promise<BusyInterval[]> {
  await useAccount(host);
  const answer = await callGatewayTool<FreeBusyAnswer>(NAMESPACE, 'gcal_freebusy_query', {
    timeMin: new Date(timeMinMs).toISOString(),
    timeMax: new Date(timeMaxMs).toISOString(),
    timeZone: host.timeZone,
    items: host.calendarIds.map((id) => ({ id })),
  });
  const busy: BusyInterval[] = [];
  for (const [calendarId, entry] of Object.entries(answer.calendars ?? {})) {
    if (entry.errors?.length) {
      logger.warn('freebusy calendar errors', { calendarId, errors: JSON.stringify(entry.errors).slice(0, 200) });
    }
    for (const block of entry.busy ?? []) {
      const startMs = Date.parse(block.start);
      const endMs = Date.parse(block.end);
      if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) busy.push({ startMs, endMs });
    }
  }
  return busy;
}

export interface CalendarEventInput {
  summary: string;
  description: string;
  location: string;
  startMs: number;
  endMs: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  comments: string;
}

/**
 * Write the confirmed booking onto the host's first calendar. Returns
 * the Google event id. The guest is an attendee, so Google sends the
 * invite (sendUpdates: 'all'), exactly as the 2025 flow did through
 * the old API.
 */
export async function createCalendarEvent(
  host: MeetHostDoc,
  input: CalendarEventInput,
): Promise<{ eventId: string; calendarId: string }> {
  await useAccount(host);
  const calendarId = host.calendarIds[0] ?? 'primary';
  const event = await callGatewayTool<{ id?: string }>(NAMESPACE, 'gcal_events_insert', {
    calendarId,
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: { dateTime: new Date(input.startMs).toISOString(), timeZone: host.timeZone },
    end: { dateTime: new Date(input.endMs).toISOString(), timeZone: host.timeZone },
    attendees: input.guestEmail
      ? [{ email: input.guestEmail, displayName: input.guestName }]
      : [],
    sendUpdates: 'all',
    extendedProperties: {
      private: {
        name: input.guestName,
        email: input.guestEmail,
        phone: input.guestPhone,
        comments: input.comments,
        bookedVia: 'redmeet',
      },
    },
  });
  if (!event?.id) throw new Error('calendar insert returned no event id');
  return { eventId: event.id, calendarId };
}

/** The linked Google accounts the app PAT can act through (for settings). */
export async function listGoogleAccounts(): Promise<
  Array<{ connectionId: string; email: string; isDefault: boolean; status: string }>
> {
  const answer = await callGatewayTool<{
    accounts?: Array<{ connectionId: string; email: string; isDefault: boolean; status: string }>;
  }>(NAMESPACE, 'google_accounts_list', {});
  return answer.accounts ?? [];
}
