/**
 * @redmeet/core, the redMeet contracts.
 *
 * zod schemas + pure functions. Web imports from here; nothing in this
 * package does I/O.
 */
import { z } from 'zod';

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

export const profilePatchSchema = z.object({
  slug: z.string().min(2).max(40).optional(),
  displayName: z.string().min(1).max(80).optional(),
  bio: z.string().max(500).optional(),
  color: hexColorSchema.optional(),
  calendarIds: z.array(z.string().min(1).max(200)).max(20).optional(),
  googleConnectionId: z.string().max(120).nullable().optional(),
});
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

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
