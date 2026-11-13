/**
 * @redmeet/core, the redMeet contracts.
 *
 * zod schemas + pure functions. Web imports from here; nothing in this
 * package does I/O.
 */
import { z } from 'zod';

import { SLOT_STEP_MINUTES, parseTimeOfDay } from './availability';

export * from './availability';

/* ---------------- slugs ---------------- */

/**
 * Words a host slug may never be: every app route that lives at the
 * root, so a slug can never shadow one. The public booking pages are
 * `/<slug>` and `/<slug>/<meeting>`, so this list is load bearing.
 */
export const RESERVED_SLUGS = new Set([
  'app',
  'api',
  'signout',
  'signin',
  'login',
  'logout',
  'report',
  'icons',
  'templates',
  'public',
  'health',
  'manifest.webmanifest',
  'robots.txt',
  'favicon.ico',
  'redbtn',
  'redmeet',
  'meet',
  'admin',
  'settings',
  'schedule',
  'booking',
  'book',
  'booked',
  'join',
  '_next',
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** Best-effort slug from free text (an email local part, a name). */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'host';
}

/* ---------------- shared shapes ---------------- */

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #dc2626');

/**
 * One calendar a host has ticked to block slots: a (connection,
 * calendar) pair. A host's connections are their linked google
 * accounts under their own redbtn account; the pair is the unit
 * because the same calendar id means nothing without the connection
 * it lives on. `email` and `summary` are display metadata captured
 * when the pair was listed under the host's own credential.
 */
export const calendarSelectionEntrySchema = z.object({
  connectionId: z.string().min(1).max(200),
  calendarId: z.string().min(1).max(500),
  email: z.string().max(320).default(''),
  summary: z.string().max(300).default(''),
});
export type CalendarSelectionEntry = z.infer<typeof calendarSelectionEntrySchema>;

/** The calendar booking events are written to: one selected pair. */
export const calendarWriteTargetSchema = z.object({
  connectionId: z.string().min(1).max(200),
  calendarId: z.string().min(1).max(500),
});
export type CalendarWriteTarget = z.infer<typeof calendarWriteTargetSchema>;

/**
 * A host's full calendar selection: every ticked (connection,
 * calendar) pair across ANY of their connections, plus the single
 * write target. The server re-proves every connectionId against the
 * host's own credential before storing any of this (see the profile
 * route), so the schema only shapes the payload.
 */
export const calendarSelectionSchema = z.object({
  calendars: z.array(calendarSelectionEntrySchema).max(60),
  writeTarget: calendarWriteTargetSchema.nullable().default(null),
});
export type CalendarSelection = z.infer<typeof calendarSelectionSchema>;

const timeOfDaySchema = z
  .string()
  .regex(/^\d{1,2}:\d{2}$/, 'Use a time like 10:00')
  .refine((v) => parseTimeOfDay(v) !== null, 'Use a valid time of day')
  .refine((v) => (parseTimeOfDay(v) ?? 0) % SLOT_STEP_MINUTES === 0, 'Times must fall on the hour or half hour');

const dayWindowSchema = z
  .object({ start: timeOfDaySchema, end: timeOfDaySchema })
  .refine((d) => (parseTimeOfDay(d.start) ?? 0) < (parseTimeOfDay(d.end) ?? 0), {
    message: 'Start time must be before the end time',
  });

/**
 * A host's booking hours: weekday and weekend windows as "HH:mm"
 * wall times in the host's zone. The defaults live in availability.ts
 * (DEFAULT_AVAILABILITY_WINDOWS); this schema only shapes and checks
 * what a host saves.
 */
export const availabilityWindowsSchema = z.object({
  weekday: dayWindowSchema,
  weekend: dayWindowSchema,
});
export type AvailabilityWindowsInput = z.infer<typeof availabilityWindowsSchema>;

export const profilePatchSchema = z.object({
  slug: z.string().min(2).max(40).optional(),
  displayName: z.string().min(1).max(80).optional(),
  bio: z.string().max(500).optional(),
  color: hexColorSchema.optional(),
  availabilityWindows: availabilityWindowsSchema.optional(),
  calendarSelection: calendarSelectionSchema.optional(),
  // NOTE: connection ids are deliberately NOT patchable on their own
  // here. A connection id may only ever be stored when it came from a
  // list returned under the host's own credential: the connect flow
  // proves that for the credential itself, and the profile route
  // re-proves every connectionId inside a calendarSelection against
  // google_accounts_list under the host's stored credential. Accepting
  // a bare connection id from a generic patch would let a caller point
  // a host at a connection that was never theirs.
});
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

/** Step 1 of connecting a calendar: the host pastes their own redbtn
 *  personal access token so the app can list the google accounts that
 *  token owns. The token is validated, never stored, at this step. */
export const calendarValidateSchema = z.object({
  token: z.string().min(10).max(500),
});
export type CalendarValidate = z.infer<typeof calendarValidateSchema>;

/** Step 2: store the credential. The connectionId is the account the
 *  host picked in step 1 (their default connection); it must be one
 *  the validate step listed under this same token, and the route
 *  re-lists and checks before it stores anything. Every account in
 *  that list is recorded as a usable connection, because the calendar
 *  picker spans all of the host's connections, not just this one. */
export const calendarConnectSchema = z.object({
  token: z.string().min(10).max(500),
  connectionId: z.string().min(1).max(200),
});
export type CalendarConnect = z.infer<typeof calendarConnectSchema>;

export const meetingTypeInputSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase words separated by dashes'),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  lengthMinutes: z.number().int().min(5).max(480).default(30),
  active: z.boolean().default(true),
  /**
   * Entry mode (Epic 4, feature 4.3): 'open' lets the guest
   * enter as soon as the room opens; 'waiting_room' holds them
   * in a waiting state until the host admits them. Bookings
   * copy the mode at booking time.
   */
  entryMode: z.enum(['open', 'waiting_room']).default('open'),
});
export type MeetingTypeInput = z.infer<typeof meetingTypeInputSchema>;

export const meetingTypePatchSchema = meetingTypeInputSchema.partial();
export type MeetingTypePatch = z.infer<typeof meetingTypePatchSchema>;

/**
 * What a guest submits. The client sends the date and the slot LABEL;
 * the server recomputes the instant through the availability math, so
 * a crafted request cannot book outside the offered slots.
 */
export const bookingInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().min(4).max(8),
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(30).optional().default(''),
  comments: z.string().max(1000).optional().default(''),
});
export type BookingInput = z.infer<typeof bookingInputSchema>;

/** Lighten a hex colour the way the original booking page did. */
export function lightenColor(color: string, percent: number): string {
  const num = parseInt(color.replace('#', ''), 16);
  if (Number.isNaN(num)) return color;
  const amt = Math.round(2.55 * percent);
  const r = Math.min(255, Math.max(0, (num >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amt));
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amt));
  return `#${((0x1000000 + r * 0x10000 + g * 0x100 + b) >>> 0).toString(16).slice(1)}`;
}
