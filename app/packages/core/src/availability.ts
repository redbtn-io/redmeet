/**
 * Availability math, ported from the original 2025 redMeet
 * (`src/calls/calendar.ts` `availableTimes`), made pure and testable.
 *
 * The original's rules, kept:
 *   - 30 minute slots.
 *   - Weekdays (Mon to Fri): starts from 10:00AM, last end 8:00PM.
 *   - Weekends (Sat, Sun): starts from 10:00AM, last end 2:00PM.
 *   - A busy block also blocks the one slot before it (buffer; the
 *     original gave the "Life Time" calendar two, v1 keeps one for all).
 *   - Same-day slots need two hours of lead time.
 *   - Everything is reckoned in the host's time zone (America/New_York
 *     in v1, as in the original).
 *
 * Busy blocks arrive as UTC millisecond intervals from the gateway's
 * free/busy answer; this module never does I/O.
 */

export const SLOT_STEP_MINUTES = 30;
export const LEAD_MINUTES = 120;
export const DEFAULT_TIME_ZONE = 'America/New_York';

export interface BusyInterval {
  startMs: number;
  endMs: number;
}

export interface Slot {
  /** Display label in the original's style, e.g. "10:00AM", "1:30PM". */
  label: string;
  startMs: number;
  endMs: number;
}

const WEEKDAY_WINDOW = { start: 10 * 60, end: 20 * 60 };
const WEEKEND_WINDOW = { start: 10 * 60, end: 14 * 60 };

/** Format minutes-since-midnight the way the original picker did. */
export function formatTimeLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')}${period}`;
}

/** Parse a label like "10:00AM" or "1:30PM" back to minutes-since-midnight. */
export function parseTimeLabel(label: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(AM|PM)$/i.exec(label.trim());
  if (!match) return null;
  let h = parseInt(match[1]!, 10);
  const m = parseInt(match[2]!, 10);
  const period = match[3]!.toUpperCase();
  if (h < 1 || h > 12 || m > 59) return null;
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

/**
 * UTC offset (ms) of `timeZone` at the given UTC instant: the amount to
 * ADD to UTC to get wall time there.
 */
function tzOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  const hour = get('hour') % 24;
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The UTC instant of a wall-clock time (`date` is YYYY-MM-DD) in `timeZone`. */
export function zonedTimeToUtcMs(date: string, minutesSinceMidnight: number, timeZone: string): number {
  const [y, mo, d] = date.split('-').map((p) => parseInt(p, 10)) as [number, number, number];
  const naiveUtc = Date.UTC(y, mo - 1, d) + minutesSinceMidnight * 60_000;
  // Two passes settle DST-transition days.
  const first = naiveUtc - tzOffsetMs(naiveUtc, timeZone);
  return naiveUtc - tzOffsetMs(first, timeZone);
}

/** YYYY-MM-DD of `instantMs` as seen in `timeZone`. */
export function dateInZone(instantMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Day of week (0 = Sunday) for a YYYY-MM-DD calendar date. */
export function weekdayOf(date: string): number {
  const [y, mo, d] = date.split('-').map((p) => parseInt(p, 10)) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export interface AvailableSlotsInput {
  /** YYYY-MM-DD in the host's time zone. */
  date: string;
  durationMinutes: number;
  busy: BusyInterval[];
  nowMs: number;
  timeZone?: string;
}

/**
 * The bookable slots for one day. A slot is out when it overlaps a busy
 * block (with one slot of buffer before the block), ends after the
 * day's window, or starts inside the same-day lead time.
 */
export function availableSlots(input: AvailableSlotsInput): Slot[] {
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const day = weekdayOf(input.date);
  const weekend = day === 0 || day === 6;
  const win = weekend ? WEEKEND_WINDOW : WEEKDAY_WINDOW;
  const isToday = dateInZone(input.nowMs, timeZone) === input.date;
  const earliestStart = isToday ? input.nowMs + LEAD_MINUTES * 60_000 : Number.NEGATIVE_INFINITY;

  const slots: Slot[] = [];
  for (let start = win.start; start + input.durationMinutes <= win.end; start += SLOT_STEP_MINUTES) {
    const startMs = zonedTimeToUtcMs(input.date, start, timeZone);
    const endMs = startMs + input.durationMinutes * 60_000;
    if (startMs < earliestStart) continue;
    const blocked = input.busy.some(
      (b) => startMs < b.endMs && endMs > b.startMs - SLOT_STEP_MINUTES * 60_000,
    );
    if (blocked) continue;
    slots.push({ label: formatTimeLabel(start), startMs, endMs });
  }
  return slots;
}
