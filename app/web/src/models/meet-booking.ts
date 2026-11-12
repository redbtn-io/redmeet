import 'server-only';
import { model, models, Schema, Types, type Model } from 'mongoose';

/**
 * MeetBooking, one guest's booking through a public link.
 *
 * A booking is written `pending_calendar` first, then the calendar event
 * is created through the gateway; success flips it to `confirmed` with
 * the event id, failure leaves `calendar_failed` with the error kept.
 * The guest only ever sees a confirmation when the status is
 * `confirmed` (or an honest "booked, calendar invite pending" state:
 * never a fake event id).
 *
 * Slot integrity (Epic 0): a PARTIAL UNIQUE index on (hostId, start)
 * covers the live statuses (pending_calendar, confirmed,
 * calendar_failed), so MongoDB itself rejects a second live booking
 * for the same host and start. A cancelled booking falls out of the
 * index, which is what frees its slot. createBooking claims the slot
 * with an upsert keyed on that index (see lib/bookings.ts), so two
 * concurrent requests for the same slot cannot both pass.
 */
export type BookingStatus = 'pending_calendar' | 'confirmed' | 'calendar_failed' | 'cancelled';

/** Statuses that hold their slot against new bookings. */
export const SLOT_HOLDING_STATUSES: BookingStatus[] = [
  'pending_calendar',
  'confirmed',
  'calendar_failed',
];

export interface MeetBookingDoc {
  _id: Types.ObjectId;
  hostId: Types.ObjectId;
  meetTypeId: Types.ObjectId;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  comments: string;
  start: Date;
  end: Date;
  status: BookingStatus;
  /** Google calendar id the event was written to. */
  calendarId?: string;
  /** Google event id, set only when the write succeeded. */
  calendarEventId?: string;
  calendarError?: string;
  /** How many times a calendar write has been attempted for this booking. */
  calendarAttempts: number;
  /** When the most recent calendar write was attempted. */
  lastCalendarAttemptAt?: Date;
  /** Random token written by the atomic slot claim; see lib/bookings.ts. */
  claimToken?: string;
  /** When the host cancelled the booking. */
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const meetBookingSchema = new Schema<MeetBookingDoc>(
  {
    hostId: { type: Schema.Types.ObjectId, ref: 'MeetHost', required: true, index: true },
    meetTypeId: { type: Schema.Types.ObjectId, ref: 'MeetType', required: true, index: true },
    guestName: { type: String, required: true },
    guestEmail: { type: String, required: true },
    guestPhone: { type: String, default: '' },
    comments: { type: String, default: '' },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending_calendar', 'confirmed', 'calendar_failed', 'cancelled'],
      required: true,
      default: 'pending_calendar',
    },
    calendarId: String,
    calendarEventId: String,
    calendarError: String,
    calendarAttempts: { type: Number, default: 0 },
    lastCalendarAttemptAt: Date,
    claimToken: String,
    cancelledAt: Date,
  },
  { timestamps: true },
);

meetBookingSchema.index(
  { hostId: 1, start: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: SLOT_HOLDING_STATUSES } },
  },
);
// The reconciliation sweep scans by status and age.
meetBookingSchema.index({ status: 1, updatedAt: 1 });

export const MeetBooking: Model<MeetBookingDoc> =
  models.MeetBooking ?? model<MeetBookingDoc>('MeetBooking', meetBookingSchema);
