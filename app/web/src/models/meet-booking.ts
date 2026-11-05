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
 */
export type BookingStatus = 'pending_calendar' | 'confirmed' | 'calendar_failed' | 'cancelled';

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
  },
  { timestamps: true },
);

meetBookingSchema.index({ hostId: 1, start: 1 });

export const MeetBooking: Model<MeetBookingDoc> =
  models.MeetBooking ?? model<MeetBookingDoc>('MeetBooking', meetBookingSchema);
