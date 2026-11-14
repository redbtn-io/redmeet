import 'server-only';

import { getDb } from '@/lib/db';
import { logger } from '@/lib/log';
import { MAX_AUTO_CALENDAR_ATTEMPTS, retryBookingCalendar } from '@/lib/bookings';
import { refreshRecording } from '@/lib/recording';
import { MeetBooking } from '@/models/meet-booking';
import { MeetHost } from '@/models/meet-host';

/**
 * Calendar reconciliation sweep (Epic 0).
 *
 * A booking whose calendar write failed used to sit in
 * `calendar_failed` forever: no retry, no job, no alert, while the
 * guest waited for an invite that was never coming. This sweep is
 * the retry path. Every few minutes it picks up bookings that have
 * been `calendar_failed` for at least 15 minutes and re-attempts the
 * write, up to MAX_AUTO_CALENDAR_ATTEMPTS total attempts per booking.
 * After the cap it stops and leaves the badge on the dashboard, where
 * the host can still retry by hand.
 *
 * There is no scheduler infrastructure in this app, so the sweep
 * runs on an in-process interval started once at server boot (see
 * instrumentation.ts). redMeet runs as a single container; the
 * in-flight guard also keeps overlapping ticks in one process from
 * double-writing.
 */

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SWEEP_FIRST_RUN_DELAY_MS = 30 * 1000;
const FAILED_FOR_MS = 15 * 60 * 1000;
const BATCH_LIMIT = 10;

let sweeping = false;

export async function reconcileFailedBookings(nowMs: number = Date.now()): Promise<number> {
  if (sweeping) return 0;
  sweeping = true;
  try {
    await getDb();
    const staleBefore = new Date(nowMs - FAILED_FOR_MS);
    const candidates = await MeetBooking.find({
      status: 'calendar_failed',
      calendarAttempts: { $lt: MAX_AUTO_CALENDAR_ATTEMPTS },
      updatedAt: { $lte: staleBefore },
      // A meeting that already ended does not need its invite
      // rescued; leave those for the host to see and clear.
      end: { $gte: new Date(nowMs) },
    })
      .sort({ updatedAt: 1 })
      .limit(BATCH_LIMIT);

    let fixed = 0;
    for (const booking of candidates) {
      const host = await MeetHost.findById(booking.hostId);
      if (!host) continue;
      const before = booking.status;
      await retryBookingCalendar(host, booking, { auto: true });
      if (before !== 'confirmed' && booking.status === 'confirmed') fixed += 1;
      logger.info('reconciled failed calendar booking', {
        bookingId: String(booking._id),
        status: booking.status,
        attempts: booking.calendarAttempts,
      });
    }
    return fixed;
  } catch (error) {
    logger.error('calendar reconciliation sweep failed', { error: String(error) });
    return 0;
  } finally {
    sweeping = false;
  }
}

let recordingSweeping = false;

/**
 * Recording settle sweep (Epic 6). A recording whose host
 * never comes back to the dashboard still has to land on its
 * booking: this pass refreshes every booking with a live or
 * processing recording from Egress's own report, so finished
 * files settle to ready and failed jobs settle to failed with
 * their reason, even if nobody ever polls. It runs on the
 * calendar sweep's interval; a recording stuck `recording`
 * after its room is long gone settles the same way, because
 * Egress ends the job when the room empties and closes.
 */
export async function reconcileRecordings(): Promise<number> {
  if (recordingSweeping) return 0;
  recordingSweeping = true;
  try {
    await getDb();
    const candidates = await MeetBooking.find({
      recordingStatus: { $in: ['recording', 'processing'] },
    })
      .sort({ updatedAt: 1 })
      .limit(BATCH_LIMIT);
    let settled = 0;
    for (const booking of candidates) {
      const before = booking.recordingStatus;
      await refreshRecording(booking);
      if (booking.recordingStatus !== before) settled += 1;
    }
    return settled;
  } catch (error) {
    logger.error('recording reconciliation sweep failed', { error: String(error) });
    return 0;
  } finally {
    recordingSweeping = false;
  }
}

const globalState = globalThis as { __redmeetReconcilerStarted?: boolean };

/** Start the sweep interval once per process. Safe to call again. */
export function startCalendarReconciler(): void {
  if (globalState.__redmeetReconcilerStarted) return;
  globalState.__redmeetReconcilerStarted = true;
  const first = setTimeout(() => {
    void reconcileFailedBookings();
    void reconcileRecordings();
  }, SWEEP_FIRST_RUN_DELAY_MS);
  first.unref?.();
  const timer = setInterval(() => {
    void reconcileFailedBookings();
    void reconcileRecordings();
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  logger.info('calendar reconciliation sweep started', {
    intervalMs: SWEEP_INTERVAL_MS,
  });
}
