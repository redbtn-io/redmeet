import 'server-only';

import type { BusyInterval } from '@redmeet/core';

import { callGatewayTool, type GatewayAuth } from '@/lib/gateway';
import { logger } from '@/lib/log';

/**
 * Calendar access through redbtn's own connections: the MCP gateway's
 * `google/calendar` namespace, server-side only.
 *
 * Every function here takes an explicit GatewayAuth: the credential of
 * the host whose calendar is being touched, plus the connection id
 * that host chose. There is deliberately no ambient or app level
 * credential in this module. Resolving a host record to its auth is
 * lib/calendar-auth.ts's job.
 */

const NAMESPACE = 'google/calendar';

interface FreeBusyAnswer {
  calendars?: Record<
    string,
    { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }
  >;
}

/**
 * Busy intervals across the given calendars for a window, read under
 * the host's own credential and selected connection. Throws on gateway
 * failure; callers decide whether to degrade (the booking flow falls
 * back to the app's own confirmed bookings, never to "all free").
 */
export async function getBusyIntervals(
  auth: GatewayAuth,
  timeZone: string,
  calendarIds: string[],
  timeMinMs: number,
  timeMaxMs: number,
): Promise<BusyInterval[]> {
  const answer = await callGatewayTool<FreeBusyAnswer>(
    NAMESPACE,
    'gcal_freebusy_query',
    {
      timeMin: new Date(timeMinMs).toISOString(),
      timeMax: new Date(timeMaxMs).toISOString(),
      timeZone,
      items: calendarIds.map((id) => ({ id })),
    },
    auth,
  );
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
 * Write the confirmed booking onto the host's first calendar, under
 * the host's own credential and selected connection. Returns the
 * Google event id. The guest is an attendee, so Google sends the
 * invite (sendUpdates: 'all'), exactly as the 2025 flow did through
 * the old API.
 */
export async function createCalendarEvent(
  auth: GatewayAuth,
  timeZone: string,
  calendarId: string,
  input: CalendarEventInput,
): Promise<{ eventId: string; calendarId: string }> {
  const event = await callGatewayTool<{ id?: string }>(
    NAMESPACE,
    'gcal_events_insert',
    {
      calendarId,
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: { dateTime: new Date(input.startMs).toISOString(), timeZone },
      end: { dateTime: new Date(input.endMs).toISOString(), timeZone },
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
    },
    auth,
  );
  if (!event?.id) throw new Error('calendar insert returned no event id');
  return { eventId: event.id, calendarId };
}

export interface GoogleAccountSummary {
  connectionId: string;
  email: string;
  isDefault: boolean;
  status: string;
}

/**
 * The google accounts linked to the owner of `token`, and ONLY that
 * owner: the gateway lists connections for the credential it is
 * called with. This is the one sanctioned source of connection ids
 * for a credential; the connect flow stores no id that did not come
 * from this list under the same token.
 */
export async function listGoogleAccounts(token: string): Promise<GoogleAccountSummary[]> {
  const answer = await callGatewayTool<{
    accounts?: Array<{
      connectionId?: string | null;
      email?: string | null;
      isDefault?: boolean;
      status?: string | null;
    }>;
  }>(NAMESPACE, 'google_accounts_list', {}, { token });
  return (answer.accounts ?? [])
    .filter((a): a is { connectionId: string; email: string; isDefault?: boolean; status?: string | null } =>
      typeof a.connectionId === 'string' && typeof a.email === 'string',
    )
    .map((a) => ({
      connectionId: a.connectionId,
      email: a.email,
      isDefault: a.isDefault === true,
      status: a.status ?? 'unknown',
    }));
}

export interface CalendarSummary {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string | null;
}

/** The calendars visible under an auth (a host credential plus its
 *  selected connection), for the settings calendar picker. */
export async function listCalendars(auth: GatewayAuth): Promise<CalendarSummary[]> {
  const answer = await callGatewayTool<{
    items?: Array<{
      id?: string;
      summary?: string;
      primary?: boolean;
      accessRole?: string;
      timeZone?: string;
    }>;
  }>(NAMESPACE, 'gcal_calendarlist_list', { maxResults: 100 }, auth);
  return (answer.items ?? [])
    .filter((c): c is { id: string; summary?: string; primary?: boolean; accessRole?: string; timeZone?: string } =>
      typeof c.id === 'string',
    )
    .map((c) => ({
      id: c.id,
      summary: c.summary ?? c.id,
      primary: c.primary === true,
      accessRole: c.accessRole ?? '',
      timeZone: c.timeZone ?? null,
    }));
}
