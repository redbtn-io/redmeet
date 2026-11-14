import 'server-only';
import { model, models, Schema, Types, type Model } from 'mongoose';

import type { EntryMode } from '@/models/meet-type';

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

/**
 * Room lifecycle (Epic 1). `not_created` is stamped with the room
 * fields at booking time (the room record exists from the start, so
 * the join link is stable); `live` once the room is inside its open
 * window and a token has been minted; `closed` after expiry, host
 * end, or cancellation.
 */
export type RoomStatus = 'not_created' | 'live' | 'closed';

/**
 * Waiting room admission (Epic 4, feature 4.3). `none` is a
 * guest who has not asked yet; `waiting` is an ask the host has
 * not decided; `admitted` and `denied` are the host's decisions.
 */
export type GuestAdmissionState = 'none' | 'waiting' | 'admitted' | 'denied';

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
  /**
   * Video room fields (Epic 1), stamped at booking time by
   * lib/rooms.ts. The room belongs to the booking, one room per
   * booking, never shared. The join tokens are random per booking;
   * the Mongo _id is NEVER used as a token (it is already returned
   * in booking responses and is guessable in structure).
   */
  /** LiveKit room name, unique per booking. */
  roomId?: string;
  /** The guest-facing join URL for this booking's room. */
  roomUrl?: string;
  /** Secret in the guest's join link; checked before a guest token is minted. */
  guestJoinToken?: string;
  /** Secret for the host's link-based join path (Epic 2). The dashboard path in this epic is the session. */
  hostJoinToken?: string;
  /** Room backend for this booking, copied from the meeting type. */
  roomProvider: string;
  roomStatus: RoomStatus;
  /** When the room fields were stamped (booking time). */
  roomCreatedAt?: Date;
  /** When the room stops accepting joins; end plus the close lag setting, pushed later by host extensions. */
  roomExpiresAt?: Date;
  /** True once the host has used their one room extension. */
  roomExtended: boolean;
  /**
   * Meeting behavior settings copied from the meeting type at
   * booking time (Epic 5), resolved through
   * lib/meeting-settings.ts so unset means the defaults (10
   * participants, opens 5 minutes before, closes 15 minutes
   * after, 30 minute extension, 1 extension). Bookings written
   * before these fields existed carry none of them and resolve
   * to the same defaults.
   */
  participantLimit?: number;
  openLeadMinutes?: number;
  closeLagMinutes?: number;
  extensionMinutes?: number;
  extensionsAllowed?: number;
  /** How many extensions the host has used on this booking (Epic 5). */
  roomExtensionsUsed: number;
  /** Entry mode copied from the meeting type at booking time (Epic 4, feature 4.3). */
  entryMode: EntryMode;
  /**
   * Waiting room admission for this booking's guest (Epic 4,
   * feature 4.3). Only meaningful when entryMode is
   * 'waiting_room'. The guest mint refuses until the state is
   * 'admitted', so no publishing token exists before admission.
   */
  guestAdmissionState: GuestAdmissionState;
  /** The name the guest asked to join under (their lobby name). */
  guestAdmissionName: string;
  guestAdmissionRequestedAt?: Date;
  guestAdmissionDecidedAt?: Date;
  /**
   * LiveKit identities the host removed from this booking's
   * room (Epic 4, feature 4.2). The mint checks this list,
   * which is what tells a REMOVED guest apart from a DROPPED
   * one: a drop leaves no record and the same link mints
   * again; a removal is recorded here and the same link is
   * refused for good.
   */
  removedIdentities: string[];
  /** When the host ended the meeting (Epic 4, feature 4.2). */
  roomEndedAt?: Date;
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
    roomId: { type: String, index: true },
    roomUrl: String,
    guestJoinToken: String,
    hostJoinToken: String,
    roomProvider: { type: String, default: 'livekit' },
    roomStatus: {
      type: String,
      enum: ['not_created', 'live', 'closed'],
      required: true,
      default: 'not_created',
    },
    roomCreatedAt: Date,
    roomExpiresAt: Date,
    roomExtended: { type: Boolean, default: false },
    participantLimit: Number,
    openLeadMinutes: Number,
    closeLagMinutes: Number,
    extensionMinutes: Number,
    extensionsAllowed: Number,
    roomExtensionsUsed: { type: Number, default: 0 },
    entryMode: { type: String, enum: ['open', 'waiting_room'], default: 'open' },
    guestAdmissionState: {
      type: String,
      enum: ['none', 'waiting', 'admitted', 'denied'],
      default: 'none',
    },
    guestAdmissionName: { type: String, default: '' },
    guestAdmissionRequestedAt: Date,
    guestAdmissionDecidedAt: Date,
    removedIdentities: { type: [String], default: [] },
    roomEndedAt: Date,
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
